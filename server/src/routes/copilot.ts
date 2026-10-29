import { Router, type Response } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { runCopilot } from '../ai/copilot.js';
import { changeStatus, insertApplication, setFollowUp } from '../services/applicationWrites.js';

export const copilotRouter = Router();
copilotRouter.use(requireAuth);
export const actionsRouter = Router();
actionsRouter.use(requireAuth);

const messageSchema = z.object({ content: z.string().trim().min(1, 'Type a message.').max(2000) });
const idParams = z.object({ id: z.uuid('Invalid action id.') });

const todayInIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// An action as the client sees it. A pending one past its time shows as expired.
const ACTION_SQL = `SELECT id, message_id, kind, application_id AS "applicationId", summary,
       CASE WHEN status = 'pending' AND expires_at < now() THEN 'expired' ELSE status END AS status,
       result_application_id AS "resultApplicationId", expires_at AS "expiresAt"
     FROM pending_actions`;

copilotRouter.get('/messages', async (req, res) => {
  const userId = userIdOf(req);
  const messages = await pool.query(
    `SELECT * FROM (SELECT id, role, content, tools_used, created_at FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50) m
     ORDER BY created_at`,
    [userId],
  );
  const actions = await pool.query(`${ACTION_SQL} WHERE user_id = $1 AND message_id = ANY($2) ORDER BY created_at`, [
    userId, messages.rows.map((m) => m.id),
  ]);
  res.json(messages.rows.map((m) => ({ ...m, actions: actions.rows.filter((a) => a.message_id === m.id).map(({ message_id: _, ...a }) => a) })));
});

copilotRouter.delete('/messages', async (req, res) => {
  const userId = userIdOf(req);
  await pool.query("DELETE FROM pending_actions WHERE user_id = $1 AND status = 'pending'", [userId]);
  await pool.query('DELETE FROM chat_messages WHERE user_id = $1', [userId]);
  res.json({ message: 'Chat cleared.' });
});

const sendEvent = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

// POST /api/copilot/messages answers as server-sent events:
//   tool (a lookup started) · text (a piece of the reply) · action (a card to confirm)
//   retry (clear the text shown so far) · done · error
copilotRouter.post('/messages', async (req, res) => {
  const userId = userIdOf(req);
  const { content } = messageSchema.parse(req.body);
  const history = await pool.query<{ role: 'user' | 'assistant'; content: string }>(
    'SELECT role, content FROM (SELECT role, content, created_at FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12) m ORDER BY created_at',
    [userId],
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  const stop = new AbortController();
  res.on('close', () => { if (!res.writableEnded) stop.abort(); });

  try {
    const turn = await runCopilot({
      userId, message: content, history: history.rows, today: todayInIndia(), signal: stop.signal,
      onEvent: (e) => {
        if (e.type === 'text') sendEvent(res, 'text', { text: e.text });
        else if (e.type === 'tool') sendEvent(res, 'tool', { name: e.name });
        else if (e.type === 'retry') sendEvent(res, 'retry', {});
        else sendEvent(res, 'action', e.action);
      },
    });
    // Saved only after a full answer, so a failed turn leaves no half conversation.
    const saved = await withTransaction(async (client) => {
      const user = await client.query('INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, tools_used, created_at', [userId, 'user', content]);
      const assistant = await client.query(
        `INSERT INTO chat_messages (user_id, role, content, tools_used, created_at) VALUES ($1, 'assistant', $2, $3, now() + interval '1 millisecond')
         RETURNING id, role, content, tools_used, created_at`,
        [userId, turn.text, JSON.stringify(turn.toolsUsed.map((t) => t.name))],
      );
      await client.query('UPDATE pending_actions SET message_id = $1 WHERE user_id = $2 AND id = ANY($3)', [
        assistant.rows[0].id, userId, turn.actions.map((a) => a.id),
      ]);
      return { user: user.rows[0], assistant: { ...assistant.rows[0], actions: turn.actions } };
    });
    sendEvent(res, 'done', saved);
  } catch (err) {
    const error = err instanceof AppError ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'The copilot failed. Please try again.' };
    if (!(err instanceof AppError)) console.error(err);
    sendEvent(res, 'error', { error });
  }
  res.end();
});

// --- Confirming and cancelling proposed changes ---------------------------------------

actionsRouter.post('/:id/confirm', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const userId = userIdOf(req);
  const result = await withTransaction(async (client) => {
    const found = await client.query(
      'SELECT kind, application_id, payload, status, expires_at < now() AS expired FROM pending_actions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    const action = found.rows[0];
    if (!action) throw notFound('Action');
    if (action.status !== 'pending') throw new AppError(409, 'ACTION_DONE', `This change was already ${action.status}.`);
    if (action.expired) {
      await client.query("UPDATE pending_actions SET status = 'expired', resolved_at = now() WHERE id = $1", [id]);
      return { expired: true } as const;
    }
    let application;
    if (action.kind === 'status_change') {
      application = (await changeStatus(client, userId, action.application_id, action.payload.status, action.payload.note ?? 'Changed with the copilot'))
        ?? (await client.query('SELECT id FROM applications WHERE id = $1', [action.application_id])).rows[0];
    } else if (action.kind === 'follow_up') {
      application = await setFollowUp(client, userId, action.application_id, action.payload.date);
    } else {
      application = await insertApplication(client, userId, { ...action.payload, source: 'copilot' });
    }
    await client.query("UPDATE pending_actions SET status = 'confirmed', resolved_at = now(), result_application_id = $2 WHERE id = $1", [id, application.id]);
    return { expired: false, application } as const;
  });
  // Outside the transaction, so the expiry above is saved before the error is sent.
  if (result.expired) throw new AppError(409, 'ACTION_EXPIRED', 'This proposal expired (they last 30 minutes). Ask the copilot again.');
  const action = await pool.query(`${ACTION_SQL} WHERE id = $1`, [id]);
  const { message_id: _, ...rest } = action.rows[0];
  res.json({ action: rest, application: result.application });
});

actionsRouter.post('/:id/cancel', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const updated = await pool.query(
    `UPDATE pending_actions SET status = 'cancelled', resolved_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id`,
    [id, userIdOf(req)],
  );
  if (!updated.rows[0]) {
    const exists = await pool.query('SELECT status FROM pending_actions WHERE id = $1 AND user_id = $2', [id, userIdOf(req)]);
    if (!exists.rows[0]) throw notFound('Action');
    throw new AppError(409, 'ACTION_DONE', `This change was already ${exists.rows[0].status}.`);
  }
  const action = await pool.query(`${ACTION_SQL} WHERE id = $1`, [id]);
  const { message_id: _, ...rest } = action.rows[0];
  res.json({ action: rest });
});

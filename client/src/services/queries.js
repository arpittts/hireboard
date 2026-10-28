import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from './toast';
import api, { errorMessage } from './api';

// All server data goes through these hooks. TanStack Query caches each result
// under its key, and every change invalidates the keys it affects, so all
// pages stay in sync without manual refetching.

export const keys = {
  applications: ['applications'],
  applicationList: (params) => ['applications', 'list', params],
  application: (id) => ['applications', 'detail', id],
  stats: ['stats'],
  settings: ['settings'],
};

// --- Reads -------------------------------------------------------------------

export function useApplications(params = {}) {
  return useQuery({
    queryKey: keys.applicationList(params),
    queryFn: async () => (await api.get('/applications', { params })).data,
    // Keep showing the previous results while a new search loads.
    placeholderData: (previous) => previous,
  });
}

export function useApplication(id) {
  return useQuery({
    queryKey: keys.application(id),
    queryFn: async () => (await api.get(`/applications/${id}`)).data,
  });
}

export function useStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: async () => (await api.get('/dashboard/stats')).data,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => (await api.get('/settings')).data,
  });
}

// --- Writes ------------------------------------------------------------------

// Applications changed: refresh every list, detail page and the dashboard.
function useInvalidateApplications() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.applications });
    queryClient.invalidateQueries({ queryKey: keys.stats });
  };
}

// Create when there's no id, otherwise update.
export function useSaveApplication() {
  const invalidate = useInvalidateApplications();
  return useMutation({
    mutationFn: async ({ id, data }) =>
      (id ? await api.put(`/applications/${id}`, data) : await api.post('/applications', data)).data,
    onSuccess: (app, { id }) => {
      invalidate();
      toast.success(id ? 'Application updated' : `Added ${app.company_name}`);
    },
    // No onError toast: the form shows the error next to the fields.
  });
}

export function useDeleteApplication() {
  const invalidate = useInvalidateApplications();
  return useMutation({
    mutationFn: async (id) => (await api.delete(`/applications/${id}`)).data,
    onSuccess: () => {
      invalidate();
      toast.success('Application deleted');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not delete the application.')),
  });
}

// Status change from the Kanban board or a status menu. The card moves at once
// (optimistic update) and moves back if the server refuses.
export function useMoveApplication() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateApplications();
  return useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/applications/${id}/status`, { status })).data,
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: keys.applications });
      const snapshot = queryClient.getQueriesData({ queryKey: ['applications', 'list'] });
      queryClient.setQueriesData({ queryKey: ['applications', 'list'] }, (apps) =>
        apps?.map((app) => (app.id === id ? { ...app, status } : app)),
      );
      return { snapshot };
    },
    onError: (err, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      toast.error(errorMessage(err, 'Could not change the status.'));
    },
    onSuccess: (_data, { status }) => toast.success(`Moved to ${status}`),
    onSettled: invalidate,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings) => (await api.put('/settings', settings)).data,
    onSuccess: (settings) => {
      queryClient.setQueryData(keys.settings, settings);
      toast.success(settings.remindersEnabled ? 'Email reminders are on' : 'Email reminders are off');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not save the setting.')),
  });
}

// --- AI ----------------------------------------------------------------------

export function useAiUsage() {
  return useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => (await api.get('/ai/usage')).data,
  });
}

// Job description text → suggested form fields. Errors are shown in the form.
export function useExtractJobDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text) => (await api.post('/ai/jd/extract', { text })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ai-usage'] }),
  });
}

// --- Resumes and the requirements checklist ------------------------------------

export function useResumes() {
  return useQuery({ queryKey: ['resumes'], queryFn: async () => (await api.get('/resumes')).data });
}

export function useResume(id) {
  return useQuery({
    queryKey: ['resumes', id],
    queryFn: async () => (await api.get(`/resumes/${id}`)).data,
    enabled: Boolean(id),
  });
}

// { title, file } uploads a PDF; { title, text } sends pasted text.
export function useAddResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, file, text }) => {
      if (file) {
        const form = new FormData();
        form.append('title', title);
        form.append('file', file);
        return (await api.post('/resumes', form)).data;
      }
      return (await api.post('/resumes', { title, text })).data;
    },
    onSuccess: (resume) => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
      toast.success(`Saved "${resume.title}" with ${resume.bulletCount} lines`);
    },
  });
}

export function useActivateResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => (await api.put(`/resumes/${id}/activate`)).data,
    onSuccess: (resume) => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      toast.success(`"${resume.title}" is now your active resume`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => (await api.delete(`/resumes/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      toast.success('Resume deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRequirementCheck(applicationId) {
  return useQuery({
    queryKey: ['requirements', applicationId],
    queryFn: async () => (await api.get(`/applications/${applicationId}/requirements`)).data,
  });
}

export function useRunRequirementCheck(applicationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/applications/${applicationId}/requirements`)).data,
    onSuccess: (check) => {
      queryClient.setQueryData(['requirements', applicationId], check);
      // The check may have read the job description and saved its requirements.
      queryClient.invalidateQueries({ queryKey: keys.application(applicationId) });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });
}

// --- Interview prep --------------------------------------------------------------

export function useQuestionBank(applicationId) {
  return useQuery({
    queryKey: ['questions', applicationId],
    queryFn: async () => (await api.get(`/applications/${applicationId}/questions`)).data,
  });
}

export function useGenerateQuestions(applicationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/applications/${applicationId}/questions`)).data,
    onSuccess: (bank) => {
      queryClient.setQueryData(['questions', applicationId], bank);
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });
}

// Save edits: [{ id?, text }] in the order to keep.
export function useSaveQuestions(applicationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (questions) => (await api.put(`/applications/${applicationId}/questions`, { questions })).data,
    onSuccess: (bank) => queryClient.setQueryData(['questions', applicationId], bank),
    onError: (err) => toast.error(errorMessage(err, 'Could not save the questions.')),
  });
}

export function useInterviews(applicationId) {
  return useQuery({
    queryKey: ['interviews', applicationId],
    queryFn: async () => (await api.get(`/applications/${applicationId}/interviews`)).data,
  });
}

export function useStartInterview(applicationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/applications/${applicationId}/interviews`)).data,
    onSuccess: (session) => {
      queryClient.setQueryData(['interview', session.id], session);
      queryClient.invalidateQueries({ queryKey: ['interviews', applicationId] });
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not start the interview.')),
  });
}

export function useInterview(id) {
  return useQuery({ queryKey: ['interview', id], queryFn: async () => (await api.get(`/interviews/${id}`)).data });
}

export function useAnswer(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (answer) => (await api.post(`/interviews/${id}/answer`, { answer })).data,
    onSuccess: (session) => {
      queryClient.setQueryData(['interview', id], session);
      queryClient.invalidateQueries({ queryKey: ['interviews', session.application_id] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    },
  });
}

export function useEndInterview(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/interviews/${id}/end`)).data,
    onSuccess: (session) => {
      queryClient.setQueryData(['interview', id], session);
      queryClient.invalidateQueries({ queryKey: ['interviews', session.application_id] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// --- Interview feedback ------------------------------------------------------------

export function useGetFeedback(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/interviews/${id}/feedback`)).data,
    onSuccess: (session) => {
      queryClient.setQueryData(['interview', id], session);
      queryClient.invalidateQueries({ queryKey: ['interviews', session.application_id] });
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
      if (session.feedbackFailed > 0) toast.error(`${session.feedbackFailed} answer(s) could not be graded. Try again for those.`);
    },
  });
}

export function useRubric() {
  return useQuery({ queryKey: ['rubric'], queryFn: async () => (await api.get('/interviews/rubric')).data, staleTime: Infinity });
}

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

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import Toaster from './components/Toaster.jsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 30 s; switching pages doesn't refetch right away.
      staleTime: 30_000,
      // Retry once after a network or server error; a 4xx answer won't change.
      retry: (failureCount, error) => failureCount < 1 && !(error.response?.status < 500),
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)

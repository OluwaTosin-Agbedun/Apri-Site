import React from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import Home from './pages/Home';
import Services from './pages/Services';
import RequestBriefing from './pages/RequestBriefing';
import AdminLayout from './pages/AdminLayout';
import AdminDashboard from './pages/AdminDashboard';
import AdminDocuments from './pages/AdminDocuments';
import AdminSubscribers from './pages/AdminSubscribers';
import AdminBriefings from './pages/AdminBriefings';
import ScrollToHash from './components/ScrollToHash';
import { AppProvider } from './context/AppContext';

const router = createBrowserRouter([
  {
    element: (
      <>
        <ScrollToHash />
        <Home />
      </>
    ),
    path: '/',
  },
  {
    path: '/services',
    element: <Services />,
  },
  {
    path: '/request-briefing',
    element: <RequestBriefing />,
  },
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: <AdminDashboard />,
      },
      {
        path: 'documents',
        element: <AdminDocuments />,
      },
      {
        path: 'subscribers',
        element: <AdminSubscribers />,
      },
      {
        path: 'briefings',
        element: <AdminBriefings />,
      }
    ],
  },
]);

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SimpleLayout } from '@/pages/campus/SimpleLayout';
import { SkeletonRows } from '@/components/ui';

// Simplified MTC system: one page to report a fire, one page for the drone pilot.
const ReportPage = lazy(() => import('@/pages/campus/ReportPage'));
const PilotPage = lazy(() => import('@/pages/campus/PilotPage'));

export default function App() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <Routes>
        <Route element={<SimpleLayout />}>
          <Route index element={<ReportPage />} />
          <Route path="pilot" element={<PilotPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

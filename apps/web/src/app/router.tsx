import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { PageLoader } from "../components/ui";

const DiscoverPage = lazy(() => import("../pages/DiscoverPage"));
const MoviePage = lazy(() => import("../pages/MoviePage"));
const SeatSelectionPage = lazy(() => import("../pages/SeatSelectionPage"));
const CheckoutPage = lazy(() => import("../pages/CheckoutPage"));
const BookingPage = lazy(() => import("../pages/BookingPage"));
const LookupPage = lazy(() => import("../pages/LookupPage"));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage"));

export function AppRouter() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell>
        <Suspense fallback={<PageLoader label="Setting the scene…" />}>
          <Routes>
            <Route path="/" element={<DiscoverPage />} />
            <Route path="/movies/:movieId" element={<MoviePage />} />
            <Route path="/showtimes/:showtimeId/seats" element={<SeatSelectionPage />} />
            <Route path="/checkout/:bookingRef" element={<CheckoutPage />} />
            <Route path="/booking/:bookingRef" element={<BookingPage />} />
            <Route path="/lookup" element={<LookupPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  );
}

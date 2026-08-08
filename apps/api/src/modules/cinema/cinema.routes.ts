import { Router } from 'express';
import type { CinemaHandler } from './cinema.handler.js';

export function movieRoutes(handler: CinemaHandler): Router {
  const router = Router();
  router.get('/', handler.listMovies);
  router.get('/:id', handler.getMovieById);
  return router;
}

export function showtimeRoutes(handler: CinemaHandler): Router {
  const router = Router();
  router.get('/', handler.listShowtimes);
  router.get('/:id', handler.getShowtimeById);
  router.get('/:id/seats', handler.getSeats);
  return router;
}

export function bookingRoutes(handler: CinemaHandler): Router {
  const router = Router();
  router.post('/', handler.createBooking);
  router.get('/:ref', handler.getBookingByRef);
  router.delete('/:ref/hold', handler.releaseHold);
  return router;
}

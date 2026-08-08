import type { RequestHandler } from 'express';
import { z } from 'zod';

import { CreateBookingBodySchema, GetShowtimesQuerySchema } from '@baseplate/contracts';

import { asyncRoute } from '../../http/async-route.js';
import { parseOrThrow } from '../../http/validate.js';
import type { CinemaService } from './cinema.service.js';

const SingleIdParamsSchema = z.object({ id: z.string().min(1, 'id must not be empty') });
const SingleRefParamsSchema = z.object({ ref: z.string().min(1, 'ref must not be empty') });

export class CinemaHandler {
  constructor(private readonly service: CinemaService) {}

  readonly listMovies: RequestHandler = asyncRoute(async (_req, res) => {
    const movies = await this.service.listMovies();
    res.status(200).json(movies);
  });

  readonly getMovieById: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = parseOrThrow(SingleIdParamsSchema, req.params);
    const movie = await this.service.getMovieById(id);
    res.status(200).json(movie);
  });

  readonly listShowtimes: RequestHandler = asyncRoute(async (req, res) => {
    const query = parseOrThrow(GetShowtimesQuerySchema, req.query);
    const showtimes = await this.service.listShowtimes(query.movieId);
    res.status(200).json(showtimes);
  });

  readonly getShowtimeById: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = parseOrThrow(SingleIdParamsSchema, req.params);
    const showtime = await this.service.getShowtimeById(id);
    res.status(200).json(showtime);
  });

  readonly getSeats: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = parseOrThrow(SingleIdParamsSchema, req.params);
    const seatMap = await this.service.getSeatMap(id);
    res.status(200).json(seatMap);
  });

  readonly createBooking: RequestHandler = asyncRoute(async (req, res) => {
    const body = parseOrThrow(CreateBookingBodySchema, req.body);
    const booking = await this.service.createBooking(body);
    res.status(201).location(`/bookings/${booking.ref}`).json(booking);
  });

  readonly getBookingByRef: RequestHandler = asyncRoute(async (req, res) => {
    const { ref } = parseOrThrow(SingleRefParamsSchema, req.params);
    const booking = await this.service.getBookingByRef(ref);
    res.status(200).json(booking);
  });

  readonly releaseHold: RequestHandler = asyncRoute(async (req, res) => {
    const { ref } = parseOrThrow(SingleRefParamsSchema, req.params);
    await this.service.releaseHold(ref);
    res.status(200).json({ status: 'CANCELLED', message: 'Hold released' });
  });
}

export const queryKeys = {
  movies: ["movies"] as const,
  movie: (id: string) => ["movies", id] as const,
  showtimes: (movieId?: string) => ["showtimes", movieId ?? "all"] as const,
  showtime: (id: string) => ["showtime", id] as const,
  seats: (id: string) => ["seats", id] as const,
  booking: (ref: string) => ["booking", ref] as const,
  health: ["health"] as const,
};

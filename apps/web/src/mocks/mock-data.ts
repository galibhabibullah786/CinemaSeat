import type { Movie, Seat, Showtime } from "../api/types";

export const mockMovies: Movie[] = [
  {
    id: "dune-part-two",
    title: "Dune: Part Two",
    synopsis: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.",
    posterUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop",
    backdropUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1600&auto=format&fit=crop",
    durationMinutes: 166,
    certificate: "PG-13",
    genres: ["Sci-Fi", "Adventure"],
  },
  {
    id: "interstellar",
    title: "Interstellar",
    synopsis: "When Earth becomes uninhabitable, a team of exoplanet explorers travels through a wormhole in search of a new home.",
    posterUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop",
    backdropUrl: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=1600&auto=format&fit=crop",
    durationMinutes: 169,
    certificate: "PG-13",
    genres: ["Sci-Fi", "Drama"],
  },
  {
    id: "oppenheimer",
    title: "Oppenheimer",
    synopsis: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.",
    posterUrl: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=800&auto=format&fit=crop",
    backdropUrl: "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?q=80&w=1600&auto=format&fit=crop",
    durationMinutes: 180,
    certificate: "R",
    genres: ["Biography", "Drama"],
  },
  {
    id: "spider-man-across-the-spider-verse",
    title: "Spider-Man: Across the Spider-Verse",
    synopsis: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.",
    posterUrl: "https://images.unsplash.com/photo-1635805737707-575885ab0820?q=80&w=800&auto=format&fit=crop",
    backdropUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?q=80&w=1600&auto=format&fit=crop",
    durationMinutes: 140,
    certificate: "PG",
    genres: ["Animation", "Action"],
  },
];

export function createShowtimeDate(dayOffset: number, hours: number, minutes: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function generateMockShowtimes(): Showtime[] {
  const showtimes: Showtime[] = [];

  const schedules = [
    { offset: 0, times: [{ h: 14, m: 15 }, { h: 17, m: 30 }, { h: 20, m: 45 }] },
    { offset: 1, times: [{ h: 15, m: 0 }, { h: 18, m: 15 }, { h: 21, m: 30 }] },
    { offset: 2, times: [{ h: 14, m: 0 }, { h: 17, m: 15 }, { h: 20, m: 45 }] },
    { offset: 3, times: [{ h: 13, m: 45 }, { h: 17, m: 0 }, { h: 20, m: 15 }] },
  ];

  const theatres = [
    { name: "CinemaSeat Grand IMAX", screen: "Screen 1 (IMAX)", priceCents: 1800 },
    { name: "CinemaSeat Downtown", screen: "Screen 3", priceCents: 1500 },
    { name: "CinemaSeat Royal Palace", screen: "Screen 2 70mm", priceCents: 2000 },
  ];

  for (const movie of mockMovies) {
    schedules.forEach(({ offset, times }) => {
      times.forEach(({ h, m }, timeIndex) => {
        const theatre = theatres[timeIndex % theatres.length]!;
        let id = `st-${movie.id}-${offset}-${timeIndex + 1}`;
        if (movie.id === "dune-part-two" && offset === 0 && timeIndex === 0) id = "st-dune-1";
        if (movie.id === "dune-part-two" && offset === 0 && timeIndex === 1) id = "st-dune-2";
        if (movie.id === "interstellar" && offset === 0 && timeIndex === 0) id = "st-interstellar-1";
        if (movie.id === "oppenheimer" && offset === 1 && timeIndex === 0) id = "st-oppenheimer-1";

        showtimes.push({
          id,
          movieId: movie.id,
          startsAt: createShowtimeDate(offset, h, m),
          theatreName: theatre.name,
          screenName: theatre.screen,
          priceCents: theatre.priceCents,
          currency: "USD",
          availableSeats: 48 - ((offset * 3 + timeIndex * 4) % 15),
          totalSeats: 60,
        });
      });
    });
  }

  return showtimes;
}

export const mockShowtimes: Showtime[] = generateMockShowtimes();

export function createMockSeats(showtime: Showtime): Seat[] {
  const seats: Seat[] = [];
  const rows = ["A", "B", "C", "D", "E"];
  const seatsPerRow = 12;

  rows.forEach((rowLabel, rowIndex) => {
    for (let number = 1; number <= seatsPerRow; number++) {
      const id = `${showtime.id}-${rowLabel}${number}`;
      let status: Seat["status"] = "AVAILABLE";

      if ((rowIndex === 0 && number <= 3) || (rowIndex === 2 && number >= 5 && number <= 7)) {
        status = "BOOKED";
      } else if (rowIndex === 1 && number === 6) {
        status = "HELD";
      }

      seats.push({
        id,
        rowLabel,
        seatNumber: number,
        label: `${rowLabel}${number}`,
        status,
        priceCents: showtime.priceCents + (rowIndex >= 3 ? 200 : 0),
        seatClass: rowIndex >= 3 ? "VIP" : "Standard",
      });
    }
  });

  return seats;
}

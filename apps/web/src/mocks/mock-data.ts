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

const today = new Date();
const formattedToday = today.toISOString().split("T")[0];
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);
const formattedTomorrow = tomorrow.toISOString().split("T")[0];

export const mockShowtimes: Showtime[] = [
  {
    id: "st-dune-1",
    movieId: "dune-part-two",
    startsAt: `${formattedToday}T19:30:00.000Z`,
    theatreName: "CinemaSeat Grand IMAX",
    screenName: "Screen 1 (IMAX)",
    priceCents: 1800,
    currency: "USD",
    availableSeats: 48,
    totalSeats: 60,
  },
  {
    id: "st-dune-2",
    movieId: "dune-part-two",
    startsAt: `${formattedToday}T22:15:00.000Z`,
    theatreName: "CinemaSeat Grand IMAX",
    screenName: "Screen 1 (IMAX)",
    priceCents: 1800,
    currency: "USD",
    availableSeats: 52,
    totalSeats: 60,
  },
  {
    id: "st-interstellar-1",
    movieId: "interstellar",
    startsAt: `${formattedToday}T20:00:00.000Z`,
    theatreName: "CinemaSeat Downtown",
    screenName: "Screen 3",
    priceCents: 1500,
    currency: "USD",
    availableSeats: 35,
    totalSeats: 60,
  },
  {
    id: "st-oppenheimer-1",
    movieId: "oppenheimer",
    startsAt: `${formattedTomorrow}T18:00:00.000Z`,
    theatreName: "CinemaSeat Grand IMAX",
    screenName: "Screen 2 70mm",
    priceCents: 2000,
    currency: "USD",
    availableSeats: 20,
    totalSeats: 60,
  },
];

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

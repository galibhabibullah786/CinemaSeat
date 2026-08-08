import { PrismaClient } from '../generated/prisma/index.js';

const prisma = new PrismaClient();

function createShowtimeDate(dayOffset: number, hours: number, minutes: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('Seeding CinemaSeat database...');

  // 1. Movies (4 movies)
  const moviesData = [
    {
      id: 'dune-part-two',
      title: 'Dune: Part Two',
      synopsis: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
      posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=800&auto=format&fit=crop',
      backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1600&auto=format&fit=crop',
      durationMinutes: 166,
      certificate: 'PG-13',
      genres: ['Sci-Fi', 'Adventure'],
    },
    {
      id: 'interstellar',
      title: 'Interstellar',
      synopsis: 'When Earth becomes uninhabitable, a team of exoplanet explorers travels through a wormhole in search of a new home.',
      posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&auto=format&fit=crop',
      backdropUrl: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=1600&auto=format&fit=crop',
      durationMinutes: 169,
      certificate: 'PG-13',
      genres: ['Sci-Fi', 'Drama'],
    },
    {
      id: 'oppenheimer',
      title: 'Oppenheimer',
      synopsis: 'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.',
      posterUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=800&auto=format&fit=crop',
      backdropUrl: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?q=80&w=1600&auto=format&fit=crop',
      durationMinutes: 180,
      certificate: 'R',
      genres: ['Biography', 'Drama'],
    },
    {
      id: 'spider-man-across-the-spider-verse',
      title: 'Spider-Man: Across the Spider-Verse',
      synopsis: 'Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence.',
      posterUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?q=80&w=800&auto=format&fit=crop',
      backdropUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?q=80&w=1600&auto=format&fit=crop',
      durationMinutes: 140,
      certificate: 'PG',
      genres: ['Animation', 'Action'],
    },
  ];

  for (const m of moviesData) {
    await prisma.movie.upsert({
      where: { id: m.id },
      update: m,
      create: m,
    });
  }

  // 2. Theatres (2 theatres)
  const theatre1 = await prisma.theatre.upsert({
    where: { id: 'theatre-1' },
    update: { name: 'CinemaSeat Grand IMAX', location: 'Downtown Center' },
    create: { id: 'theatre-1', name: 'CinemaSeat Grand IMAX', location: 'Downtown Center' },
  });

  const theatre2 = await prisma.theatre.upsert({
    where: { id: 'theatre-2' },
    update: { name: 'CinemaSeat Royal Palace', location: 'Westside Promenade' },
    create: { id: 'theatre-2', name: 'CinemaSeat Royal Palace', location: 'Westside Promenade' },
  });

  // 3. Screens (1 per theatre)
  const screen1 = await prisma.screen.upsert({
    where: { id: 'screen-1' },
    update: { name: 'Screen 1 (IMAX)', capacity: 120, theatreId: theatre1.id },
    create: { id: 'screen-1', name: 'Screen 1 (IMAX)', capacity: 120, theatreId: theatre1.id },
  });

  const screen2 = await prisma.screen.upsert({
    where: { id: 'screen-2' },
    update: { name: 'Screen 2 70mm', capacity: 120, theatreId: theatre2.id },
    create: { id: 'screen-2', name: 'Screen 2 70mm', capacity: 120, theatreId: theatre2.id },
  });

  // 4. Seats (10 rows A-J × 12 seats per screen = 120 seats per screen)
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const seatsPerRow = 12;

  for (const screen of [screen1, screen2]) {
    for (let r = 0; r < rows.length; r++) {
      const rowLabel = rows[r]!;
      const isVIP = r >= 7; // Rows H, I, J are VIP
      const priceCents = isVIP ? 2000 : 1500;
      const seatClass = isVIP ? 'VIP' : 'Standard';

      for (let number = 1; number <= seatsPerRow; number++) {
        const seatId = `seat-${screen.id}-${rowLabel}${number}`;
        await prisma.seat.upsert({
          where: { screenId_rowLabel_seatNumber: { screenId: screen.id, rowLabel, seatNumber: number } },
          update: { seatClass, priceCents },
          create: {
            id: seatId,
            screenId: screen.id,
            rowLabel,
            seatNumber: number,
            seatClass,
            priceCents,
          },
        });
      }
    }
  }

  // Fetch seats for inventory seeding
  const seats1 = await prisma.seat.findMany({ where: { screenId: screen1.id } });
  const seats2 = await prisma.seat.findMany({ where: { screenId: screen2.id } });

  // 5. Showtimes & SeatInventories across Today, Tomorrow, Day +2, Day +3
  const schedules = [
    { offset: 0, times: [{ h: 14, m: 15 }, { h: 17, m: 30 }, { h: 20, m: 45 }] },
    { offset: 1, times: [{ h: 15, m: 0 }, { h: 18, m: 15 }, { h: 21, m: 30 }] },
    { offset: 2, times: [{ h: 14, m: 0 }, { h: 17, m: 15 }, { h: 20, m: 45 }] },
    { offset: 3, times: [{ h: 13, m: 45 }, { h: 17, m: 0 }, { h: 20, m: 15 }] },
  ];

  for (const movie of moviesData) {
    for (const { offset, times } of schedules) {
      for (let timeIdx = 0; timeIdx < times.length; timeIdx++) {
        const { h, m } = times[timeIdx]!;
        const screen = (offset + timeIdx) % 2 === 0 ? screen1 : screen2;
        const theatre = screen === screen1 ? theatre1 : theatre2;

        let id = `st-${movie.id}-${offset}-${timeIdx + 1}`;
        if (movie.id === 'dune-part-two' && offset === 0 && timeIdx === 0) id = 'st-dune-1';
        if (movie.id === 'dune-part-two' && offset === 0 && timeIdx === 1) id = 'st-dune-2';

        const startsAt = createShowtimeDate(offset, h, m);
        const priceCents = screen === screen1 ? 1800 : 1500;

        const showtime = await prisma.showtime.upsert({
          where: { id },
          update: {
            movieId: movie.id,
            theatreId: theatre.id,
            screenId: screen.id,
            startsAt,
            priceCents,
          },
          create: {
            id,
            movieId: movie.id,
            theatreId: theatre.id,
            screenId: screen.id,
            startsAt,
            priceCents,
            currency: 'USD',
          },
        });

        // 6. SeatInventory per showtime (120 seats per showtime)
        const seats = screen === screen1 ? seats1 : seats2;
        for (const seat of seats) {
          let status = 'AVAILABLE';
          // Mark a couple seats as BOOKED / HELD for realistic data
          if (seat.rowLabel === 'A' && seat.seatNumber <= 3) status = 'BOOKED';
          if (seat.rowLabel === 'B' && seat.seatNumber === 6) status = 'HELD';

          await prisma.seatInventory.upsert({
            where: { showtimeId_seatId: { showtimeId: showtime.id, seatId: seat.id } },
            update: { status, priceCents: seat.priceCents },
            create: {
              showtimeId: showtime.id,
              seatId: seat.id,
              status,
              priceCents: seat.priceCents,
            },
          });
        }
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('CinemaSeat database seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

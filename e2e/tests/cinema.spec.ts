import { expect, test, type Page } from '@playwright/test';
import type { Booking, SeatMap } from '@baseplate/contracts';

const apiUrl = process.env.VITE_API_URL ?? 'http://localhost:4000';
const showtimeId = 'st-dune-1';

async function getSeats(page: Page): Promise<SeatMap['seats']> {
  const response = await page.request.get(`${apiUrl}/showtimes/${showtimeId}/seats`);
  expect(response.status()).toBe(200);
  const body = await response.json() as SeatMap;
  return body.seats;
}

function parseSeatName(name: string | null): { rowLabel: string; seatNumber: number; label: string } {
  const match = name?.match(/Row ([^,]+), seat (\d+)/i);
  expect(match).toBeTruthy();
  return { rowLabel: match![1], seatNumber: Number(match![2]), label: `${match![1]}${match![2]}` };
}

test.describe('CinemaSeat real frontend/API integration', () => {
  test('discovers movies and showtimes, holds seats, shows details and countdown, then releases the hold', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /now showing/i })).toBeVisible();
    await expect(page.locator('.movie-card h3')).toHaveCount(4);

    await page.getByRole('heading', { name: 'Dune: Part Two', level: 3 }).click();
    await expect(page.getByRole('heading', { name: 'Dune: Part Two', level: 1 })).toBeVisible();
    const showtimeLink = page.getByRole('link', { name: /left/i }).first();
    await expect(showtimeLink).toBeVisible();
    await showtimeLink.click();

    await expect(page.getByRole('heading', { name: /review your seats/i })).toBeVisible();
    const firstAvailable = page.getByRole('button', { name: /Available/i }).first();
    const firstName = await firstAvailable.getAttribute('aria-label');
    await firstAvailable.click();
    const secondAvailable = page.getByRole('button', { name: /Available/i }).first();
    const secondName = await secondAvailable.getAttribute('aria-label');
    await secondAvailable.click();
    const firstSeat = parseSeatName(firstName);
    const secondSeat = parseSeatName(secondName);

    await Promise.all([
      page.waitForURL(/\/checkout\/CS-\d{4}-\d+/),
      page.getByRole('button', { name: /continue to verify/i }).click(),
    ]);
    const bookingRef = page.url().split('/').pop()!;

    await expect(page.getByRole('heading', { name: /verify, then take your seats/i })).toBeVisible();
    await expect(page.getByText('Dune: Part Two')).toBeVisible();
    await expect(page.locator('.summary-seat-list strong')).toContainText([firstSeat.label, secondSeat.label].join(', '));
    await expect(page.locator('.booking-ref code')).toHaveText(bookingRef);

    const countdown = page.locator('.countdown strong');
    await expect(countdown).toHaveText(/^\d{2}:\d{2}$/);
    const before = await countdown.textContent();
    await page.waitForTimeout(1_500);
    const after = await countdown.textContent();
    expect(after).not.toBe(before);

    await page.goto('/lookup');
    await page.getByLabel(/your reference/i).fill(bookingRef);
    await Promise.all([
      page.waitForURL(new RegExp(`/booking/${bookingRef}$`)),
      page.getByRole('button', { name: /view booking/i }).click(),
    ]);
    await expect(page.getByRole('heading', { name: /your booking is waiting/i })).toBeVisible();
    await page.getByRole('link', { name: /continue checkout/i }).click();

    const [releaseResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === 'DELETE' && response.url().endsWith(`/bookings/${bookingRef}/hold`),
      ),
      page.getByRole('button', { name: /exit checkout/i }).click(),
    ]);
    expect(releaseResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/lookup$/);

    const releasedSeats = await getSeats(page);
    const heldLabels = [firstSeat.label, secondSeat.label];
    for (const label of heldLabels) {
      expect(releasedSeats.find((seat) => seat.label === label)?.status).toBe('AVAILABLE');
    }
  });

  test('a competing real hold returns 409 and refreshes the frontend seat map', async ({ page }) => {
    await page.goto(`/showtimes/${showtimeId}/seats`);
    const seatButton = page.getByRole('button', { name: /Available/i }).first();
    const visibleName = await seatButton.getAttribute('aria-label');
    await seatButton.click();
    const visibleSeat = parseSeatName(visibleName);
    const availableSeat = (await getSeats(page)).find(
      (seat) => seat.rowLabel === visibleSeat.rowLabel && seat.seatNumber === visibleSeat.seatNumber,
    );
    expect(availableSeat?.status).toBe('AVAILABLE');

    const competitorResponse = await page.request.post(`${apiUrl}/bookings`, {
      data: { showtimeId, seatIds: [availableSeat!.id] },
    });
    expect(competitorResponse.status()).toBe(201);
    const competitor = await competitorResponse.json() as Pick<Booking, 'ref'>;

    try {
      const [duplicateResponse, refreshResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.request().method() === 'POST' && response.url() === `${apiUrl}/bookings`,
        ),
        page.waitForResponse((response) =>
          response.request().method() === 'GET' && response.url() === `${apiUrl}/showtimes/${showtimeId}/seats`,
        ),
        page.getByRole('button', { name: /continue to verify/i }).click(),
      ]);
      expect(duplicateResponse.status()).toBe(409);
      expect(refreshResponse.status()).toBe(200);
      const refreshedSeats = await refreshResponse.json() as SeatMap;
      await expect(page.getByRole('alert')).toContainText(/someone else just held a seat/i);
      await expect(page.getByRole('button', {
        name: new RegExp(`Row ${availableSeat!.rowLabel}, seat ${availableSeat!.seatNumber}, Selected`, 'i'),
      })).toHaveCount(0);
      expect(refreshedSeats.seats.find((seat) => seat.id === availableSeat!.id)?.status).toBe('HELD');
    } finally {
      const release = await page.request.delete(`${apiUrl}/bookings/${competitor.ref}/hold`);
      expect(release.status()).toBe(200);
    }
  });

  test('booked seats are present in the real seat map and cannot be selected', async ({ page }) => {
    await page.goto(`/showtimes/${showtimeId}/seats`);
    const bookedSeat = page.getByRole('button', { name: /Booked/i }).first();
    await expect(bookedSeat).toBeVisible();
    await expect(bookedSeat).toBeDisabled();
  });

  test('an unknown booking reference shows the real not-found state', async ({ page }) => {
    await page.goto('/checkout/CS-UNKNOWN-E2E');
    await expect(page.getByRole('heading', { name: /booking hold not found/i })).toBeVisible();
  });
});

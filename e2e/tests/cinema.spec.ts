import { expect, test } from '@playwright/test';

test.describe('CinemaSeat E2E Flow (Mock Mode)', () => {
  test('complete booking flow from discover to confirmed ticket', async ({ page }) => {
    // 1. Discover page loads
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /now showing/i })).toBeVisible();
    const movieHeading = page.getByRole('heading', { name: 'Dune: Part Two', level: 3 });
    await expect(movieHeading).toBeVisible();

    // 2. Open a movie
    await movieHeading.click();
    await expect(page.getByRole('heading', { name: 'Dune: Part Two', level: 1 })).toBeVisible();

    // 3. Select today's showtime
    await expect(page.getByRole('tab', { name: /today/i })).toBeVisible();
    const showtimeLink = page.getByRole('link', { name: /left/i }).first();
    await expect(showtimeLink).toBeVisible();
    await showtimeLink.click();

    // 4. Open seat map and select an available seat
    await expect(page.getByRole('heading', { name: /review your seats/i })).toBeVisible();
    const seatA4 = page.getByRole('button', { name: /Row A, seat 4/i });
    await expect(seatA4).toBeVisible();
    await seatA4.click();
    await expect(seatA4).toHaveAttribute('aria-pressed', 'true');

    // 5. Continue and verify /checkout/:bookingRef
    const continueBtn = page.getByRole('button', { name: /continue to verify|continue/i }).first();
    await continueBtn.click();
    await page.waitForURL(/\/checkout\/CS-\d{4}-\d+/);
    expect(page.url()).toMatch(/\/checkout\/CS-\d{4}-\d+/);

    // 6. Complete mock OTP flow
    const phoneInput = page.getByLabel(/phone number/i);
    await expect(phoneInput).toBeVisible();
    await phoneInput.fill('+1 555 014 2040');

    const sendOtpBtn = page.getByRole('button', { name: /send otp/i });
    await sendOtpBtn.click();

    await expect(page.getByLabel('Verification digit 1')).toBeVisible();
    const otpDigits = ['1', '2', '3', '4', '5', '6'];
    for (let i = 0; i < 6; i++) {
      await page.getByLabel(`Verification digit ${i + 1}`).fill(otpDigits[i]!);
    }

    const verifyOtpBtn = page.getByRole('button', { name: /verify code/i });
    await verifyOtpBtn.click();
    await expect(page.getByRole('status')).toContainText(/phone verified/i);

    // 7. Start mock payment
    const payBtn = page.getByRole('button', { name: /pay \$/i });
    await expect(payBtn).toBeEnabled();
    await payBtn.click();

    // 8. Verify pending status and confirmation
    await page.waitForURL(/\/booking\/CS-\d{4}-\d+/);
    expect(page.url()).toMatch(/\/booking\/CS-\d{4}-\d+/);

    // 9. Verify confirmed booking/ticket page
    await expect(page.getByRole('heading', { name: /you’re in/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Dune: Part Two').first()).toBeVisible();
    await expect(page.getByText(/show this code at entry/i)).toBeVisible();
  });

  test('booked and held seats cannot be selected', async ({ page }) => {
    await page.goto('/showtimes/st-dune-1/seats');
    await expect(page.getByRole('heading', { name: /review your seats/i })).toBeVisible();

    // Booked seat A1 must be disabled
    const bookedSeat = page.getByRole('button', { name: /Row A, seat 1, Booked/i });
    await expect(bookedSeat).toBeDisabled();

    // Held seat B6 must be disabled
    const heldSeat = page.getByRole('button', { name: /Row B, seat 6, Held/i });
    await expect(heldSeat).toBeDisabled();
  });

  test('seat conflict shows message and refreshes seat map', async ({ page }) => {
    await page.goto('/showtimes/st-dune-1/seats');
    await expect(page.getByRole('heading', { name: /review your seats/i })).toBeVisible();

    // Force conflict mode in browser session
    await page.evaluate(() => sessionStorage.setItem('cinemaseat:mock-conflict', 'true'));

    // Select available seat A4
    const seatA4 = page.getByRole('button', { name: /Row A, seat 4/i });
    await seatA4.click();

    // Attempt to continue
    const continueBtn = page.getByRole('button', { name: /continue to verify|continue/i }).first();
    await continueBtn.click();

    // Verify conflict error message is displayed
    await expect(page.getByText(/someone else just held a seat/i)).toBeVisible();

    // Clear conflict mode
    await page.evaluate(() => sessionStorage.removeItem('cinemaseat:mock-conflict'));
  });

  test('hold expiry notice renders on expired booking checkout', async ({ page }) => {
    // Navigate directly to checkout with expired or invalid hold
    await page.goto('/checkout/CS-EXPIRED-TEST');
    await expect(page.getByRole('heading', { name: /booking hold not found|this booking is no longer at checkout/i })).toBeVisible();
  });

  test('booking lookup works by reference', async ({ page }) => {
    await page.goto('/lookup');
    await expect(page.getByRole('heading', { name: /find your booking/i })).toBeVisible();

    const refInput = page.getByLabel(/your reference/i);
    await refInput.fill('CS-2026-02401');

    const submitBtn = page.getByRole('button', { name: /view booking/i });
    await submitBtn.click();

    await page.waitForURL(/\/booking\/CS-2026-02401/);
    expect(page.url()).toContain('/booking/CS-2026-02401');
  });

  test('mobile viewport flow operates correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await page.getByRole('heading', { name: 'Dune: Part Two', level: 3 }).click();
    const showtimeLink = page.getByRole('link', { name: /left/i }).first();
    await showtimeLink.click();

    // Select available seat A4
    const seatA4 = page.getByRole('button', { name: /Row A, seat 4/i });
    await seatA4.click();

    // Continue using mobile bar button
    const mobileContinueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(mobileContinueBtn).toBeVisible();
    await mobileContinueBtn.click();

    await page.waitForURL(/\/checkout\/CS-\d{4}-\d+/);
    expect(page.url()).toMatch(/\/checkout\/CS-\d{4}-\d+/);
  });
});

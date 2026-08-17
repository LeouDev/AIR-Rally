/**
 * @jest-environment node
 */
import { calculateSplit, formatShare, describeSplit } from "../eventSplit";

describe("calculateSplit", () => {
  it("splits ₱500 four ways at ₱125 each", () => {
    expect(calculateSplit(50000, 4)).toMatchObject({ sharePerPlayer: 12500, playerCount: 4 });
  });

  // The organiser is a player. A split that excluded them would overcharge
  // everyone else, so callers always pass the full head count.
  it("splits ₱500 eight ways at ₱62.50 each", () => {
    expect(calculateSplit(50000, 8).sharePerPlayer).toBe(6250);
  });

  it("charges one player the whole amount", () => {
    expect(calculateSplit(50000, 1)).toMatchObject({ sharePerPlayer: 50000, organiserRemainder: 50000 });
  });

  // Rounds UP so the collected shares can never total less than the bill.
  // ₱100 ÷ 3 = ₱33.34 each; the organiser ends up carrying slightly less.
  it("rounds the share up so the group is never short", () => {
    const split = calculateSplit(10000, 3);
    expect(split.sharePerPlayer).toBe(3334);
    expect(split.sharePerPlayer * 3).toBeGreaterThanOrEqual(10000);
  });

  it("leaves the rounding difference with the organiser, never the group", () => {
    const split = calculateSplit(10000, 3);
    // Two others pay 3334 each = 6668; the organiser covers 3332.
    expect(split.organiserRemainder).toBe(10000 - 3334 * 2);
    expect(split.organiserRemainder).toBeLessThan(split.sharePerPlayer);
  });

  it("never divides by zero or a negative head count", () => {
    expect(calculateSplit(50000, 0).playerCount).toBe(1);
    expect(calculateSplit(50000, -3).playerCount).toBe(1);
  });

  it("handles a free court without producing NaN", () => {
    expect(calculateSplit(0, 4)).toMatchObject({ sharePerPlayer: 0, organiserRemainder: 0 });
  });

  it("keeps everything in whole centavos", () => {
    for (const players of [3, 6, 7, 9, 11]) {
      const split = calculateSplit(50000, players);
      expect(Number.isInteger(split.sharePerPlayer)).toBe(true);
      expect(Number.isInteger(split.organiserRemainder)).toBe(true);
    }
  });
});

describe("formatShare", () => {
  it("formats pesos with two decimals", () => {
    expect(formatShare(6250)).toBe("₱62.50");
  });

  it("groups thousands", () => {
    expect(formatShare(123450)).toBe("₱1,234.50");
  });
});

describe("describeSplit", () => {
  it("shows the current share and what it becomes when full", () => {
    const described = describeSplit({ totalAmount: 50000, confirmedPlayers: 6, targetPlayers: 8 });
    expect(described.now).toBe("₱83.34 each");
    expect(described.whenFull).toBe("₱62.50 each with 8");
  });

  // Once the roster is at or past target there is no "when full" to show,
  // and repeating the same figure twice would just be noise.
  it("omits the target once the game is full", () => {
    expect(describeSplit({ totalAmount: 50000, confirmedPlayers: 8, targetPlayers: 8 }).whenFull).toBeNull();
  });
});

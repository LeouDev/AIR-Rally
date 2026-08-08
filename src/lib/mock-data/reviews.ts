import type { Review } from "@/types/court";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function review(
  courtId: string,
  authorName: string,
  rating: number,
  date: string,
  comment: string
): Review {
  return {
    id: `${courtId}-${authorName.replace(/\s+/g, "-").toLowerCase()}`,
    courtId,
    authorName,
    authorInitials: initials(authorName),
    rating,
    date,
    comment,
  };
}

export const mockReviews: Review[] = [
  review("1", "Marco Villanueva", 5, "2026-07-28", "Best indoor courts in Cebu, hands down. The AC alone is worth it."),
  review("1", "Jenna Cruz", 5, "2026-07-15", "Booked a 7am slot, court was spotless and lines were fresh. Will be back weekly."),
  review("1", "Paolo Reyes", 4, "2026-06-30", "Great facility, gets busy on weekends so book ahead."),
  review("2", "Sam Uy", 5, "2026-07-20", "Sunset games here are unbeatable. Great crowd, friendly staff."),
  review("2", "Krista Lim", 4, "2026-07-02", "Rooftop breeze makes a huge difference on hot days."),
  review("3", "Andrea Santos", 5, "2026-07-11", "Played right after a swim, the café smoothies are a nice touch."),
  review("3", "Miguel Torres", 4, "2026-06-18", "Casual vibe, perfect for a laid-back Sunday session."),
  review("4", "Liza Fernandez", 5, "2026-07-24", "Tournament-ready courts. Hosted our league finals here."),
  review("4", "Erik Tan", 5, "2026-07-05", "Eight courts means you almost never wait for a spot."),
  review("6", "Dana Ocampo", 5, "2026-06-29", "Took my daughter to the Saturday clinic, she loved it."),
  review("7", "James Ortiz", 5, "2026-07-19", "The glass walls and lounge make this feel like a real sports club."),
  review("7", "Nicole Aquino", 5, "2026-07-08", "Ladder league here is no joke — competitive and well run."),
  review("8", "Rico Manalo", 4, "2026-06-25", "Perfect for a quick lunchtime match near the office."),
];

export function getReviewsByCourtId(courtId: string): Review[] {
  return mockReviews.filter((r) => r.courtId === courtId);
}

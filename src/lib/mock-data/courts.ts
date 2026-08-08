import type { Court } from "@/types/court";

function nextDays(count: number) {
  const labels = ["Today", "Tomorrow"];
  const days: { date: string; label: string }[] = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const label =
      labels[i] ??
      d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    days.push({ date: d.toISOString().slice(0, 10), label });
  }
  return days;
}

const standardTimes = [
  "6:00 AM",
  "7:00 AM",
  "8:00 AM",
  "9:00 AM",
  "4:00 PM",
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
  "8:00 PM",
];

function buildAvailability(unavailablePattern: number[]): Court["availability"] {
  return nextDays(5).map(({ date, label }, dayIndex) => ({
    date,
    label,
    slots: standardTimes.map((time, slotIndex) => ({
      id: `${date}-${slotIndex}`,
      time,
      available: !unavailablePattern.includes((dayIndex + slotIndex) % 7),
    })),
  }));
}

export const mockCourts: Court[] = [
  {
    id: "1",
    slug: "banilad-pickle-club",
    name: "Banilad Pickle Club",
    tagline: "Cebu's premier indoor pickleball facility",
    description:
      "Six championship-grade indoor courts with cushioned acrylic surfacing and pro-level lighting. Banilad Pickle Club hosts weekly open play, ladder leagues, and beginner clinics — a favorite for players who want a consistent, air-conditioned game year-round.",
    city: "Cebu City",
    area: "Banilad",
    address: "88 Banilad Rd, Cebu City, Cebu",
    rating: 4.9,
    reviewCount: 214,
    pricePerHour: 650,
    courtType: "indoor",
    numberOfCourts: 6,
    surfaceType: "Cushioned Acrylic",
    amenityIds: ["lighting", "restrooms", "parking", "pro-shop", "water", "ac", "lockers"],
    images: [
      { surfaceColor: "blue", indoor: true },
      { surfaceColor: "navy", indoor: true },
      { surfaceColor: "teal", indoor: true },
    ],
    availability: buildAvailability([1, 4]),
    featured: true,
  },
  {
    id: "2",
    slug: "it-park-rally-courts",
    name: "IT Park Rally Courts",
    tagline: "Rooftop courts in the heart of Cebu IT Park",
    description:
      "Four open-air rooftop courts with skyline views, popular for after-work rallies. Bring your own paddle or rent one at the front desk. Lights stay on until 10 PM for evening play.",
    city: "Cebu City",
    area: "IT Park",
    address: "Cardinal Rosales Ave, Cebu City, Cebu",
    rating: 4.7,
    reviewCount: 168,
    pricePerHour: 550,
    courtType: "outdoor",
    numberOfCourts: 4,
    surfaceType: "Textured Acrylic",
    amenityIds: ["lighting", "restrooms", "parking", "water", "paddle-rental", "seating"],
    images: [
      { surfaceColor: "green", indoor: false },
      { surfaceColor: "blue", indoor: false },
    ],
    availability: buildAvailability([0, 3, 6]),
    featured: true,
  },
  {
    id: "3",
    slug: "mactan-shoreline-courts",
    name: "Mactan Shoreline Courts",
    tagline: "Beachside pickleball with ocean breeze",
    description:
      "Three outdoor courts steps from the shoreline in Lapu-Lapu. A relaxed, social atmosphere with a café on-site — a great pick for weekend games and visiting players.",
    city: "Lapu-Lapu City",
    area: "Maribago",
    address: "Maribago Beach Rd, Lapu-Lapu City, Cebu",
    rating: 4.6,
    reviewCount: 97,
    pricePerHour: 500,
    courtType: "outdoor",
    numberOfCourts: 3,
    surfaceType: "Standard Acrylic",
    amenityIds: ["parking", "cafe", "water", "seating", "wheelchair"],
    images: [
      { surfaceColor: "terracotta", indoor: false },
      { surfaceColor: "sand", indoor: false },
    ],
    availability: buildAvailability([2, 5]),
    featured: true,
  },
  {
    id: "4",
    slug: "mandaue-sports-hub",
    name: "Mandaue Sports Hub",
    tagline: "High-volume community courts",
    description:
      "Eight courts across an indoor/outdoor split facility, built for leagues and tournaments. Popular with competitive players thanks to consistent bounce and wide sidelines.",
    city: "Mandaue City",
    area: "Subangdaku",
    address: "A.S. Fortuna St, Mandaue City, Cebu",
    rating: 4.8,
    reviewCount: 156,
    pricePerHour: 480,
    courtType: "both",
    numberOfCourts: 8,
    surfaceType: "Cushioned Acrylic",
    amenityIds: ["lighting", "restrooms", "parking", "pro-shop", "water", "showers", "lockers"],
    images: [
      { surfaceColor: "blue", indoor: true },
      { surfaceColor: "green", indoor: false },
    ],
    availability: buildAvailability([1, 2, 5]),
    featured: false,
  },
  {
    id: "5",
    slug: "north-reclamation-arena",
    name: "North Reclamation Arena",
    tagline: "Budget-friendly courts, no frills",
    description:
      "Two straightforward outdoor courts for casual games. First-come, first-served walk-ins welcome alongside online booking.",
    city: "Cebu City",
    area: "North Reclamation",
    address: "Bridges Town Square, Cebu City, Cebu",
    rating: 4.3,
    reviewCount: 41,
    pricePerHour: 350,
    courtType: "outdoor",
    numberOfCourts: 2,
    surfaceType: "Standard Acrylic",
    amenityIds: ["parking", "water"],
    images: [{ surfaceColor: "teal", indoor: false }],
    availability: buildAvailability([0, 1, 2, 3]),
    featured: false,
  },
  {
    id: "6",
    slug: "talisay-family-courts",
    name: "Talisay Family Courts",
    tagline: "Family-friendly courts with beginner clinics",
    description:
      "Four indoor courts with a dedicated kids' clinic every Saturday morning. Great lighting, a calm crowd, and gear rental for first-timers.",
    city: "Cebu City",
    area: "Talisay",
    address: "Tabunok, Talisay City, Cebu",
    rating: 4.7,
    reviewCount: 88,
    pricePerHour: 500,
    courtType: "indoor",
    numberOfCourts: 4,
    surfaceType: "Cushioned Acrylic",
    amenityIds: ["lighting", "restrooms", "parking", "water", "paddle-rental", "ac"],
    images: [
      { surfaceColor: "navy", indoor: true },
      { surfaceColor: "teal", indoor: true },
    ],
    availability: buildAvailability([3, 4]),
    featured: false,
  },
  {
    id: "7",
    slug: "bgc-rally-loft",
    name: "BGC Rally Loft",
    tagline: "Premium indoor courts in the heart of BGC",
    description:
      "Five glass-walled indoor courts with climate control and a members' lounge. Home to Manila's most active competitive ladder.",
    city: "Taguig",
    area: "Bonifacio Global City",
    address: "30th St, Taguig, Metro Manila",
    rating: 4.9,
    reviewCount: 302,
    pricePerHour: 900,
    courtType: "indoor",
    numberOfCourts: 5,
    surfaceType: "Cushioned Acrylic",
    amenityIds: ["lighting", "restrooms", "parking", "pro-shop", "water", "ac", "cafe", "lockers"],
    images: [
      { surfaceColor: "blue", indoor: true },
      { surfaceColor: "navy", indoor: true },
    ],
    availability: buildAvailability([2, 6]),
    featured: true,
  },
  {
    id: "8",
    slug: "makati-central-courts",
    name: "Makati Central Courts",
    tagline: "Convenient courts for a lunchtime rally",
    description:
      "Three rooftop courts a short walk from the Makati CBD. Quick 30-minute slots make it easy to squeeze in a game between meetings.",
    city: "Makati",
    area: "Poblacion",
    address: "Kalayaan Ave, Makati, Metro Manila",
    rating: 4.5,
    reviewCount: 73,
    pricePerHour: 700,
    courtType: "outdoor",
    numberOfCourts: 3,
    surfaceType: "Textured Acrylic",
    amenityIds: ["lighting", "restrooms", "water", "seating"],
    images: [{ surfaceColor: "terracotta", indoor: false }],
    availability: buildAvailability([0, 4, 5]),
    featured: false,
  },
];

export function getCourtBySlug(slug: string): Court | undefined {
  return mockCourts.find((c) => c.slug === slug);
}

export function getCourtById(id: string): Court | undefined {
  return mockCourts.find((c) => c.id === id);
}

export function getFeaturedCourts(): Court[] {
  return mockCourts.filter((c) => c.featured);
}

export function getCourtsByCity(city: string): Court[] {
  return mockCourts.filter((c) => c.city.toLowerCase() === city.toLowerCase());
}

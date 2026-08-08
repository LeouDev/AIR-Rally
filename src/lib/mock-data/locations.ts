import type { Location } from "@/types/court";

export const mockLocations: Location[] = [
  { id: "cebu-city", city: "Cebu City", region: "Cebu", courtCount: 12 },
  { id: "mandaue", city: "Mandaue City", region: "Cebu", courtCount: 5 },
  { id: "lapu-lapu", city: "Lapu-Lapu City", region: "Cebu", courtCount: 4 },
  { id: "manila", city: "Manila", region: "Metro Manila", courtCount: 18 },
  { id: "makati", city: "Makati", region: "Metro Manila", courtCount: 9 },
  { id: "taguig", city: "Taguig", region: "Metro Manila", courtCount: 11 },
  { id: "davao-city", city: "Davao City", region: "Davao", courtCount: 7 },
];

export const defaultLocation = mockLocations[0];

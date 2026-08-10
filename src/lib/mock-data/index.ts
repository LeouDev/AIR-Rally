// `courts`, `reviews`, and `amenities` mock modules were removed in Phase 3
// — every marketplace-facing feature now reads from Supabase (see
// src/lib/services/*). `locations` remains: it's static UI data (the city
// dropdown's option list), not marketplace content, so there's nothing to
// migrate.
export * from "./locations";

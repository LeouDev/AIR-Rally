/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe("updateSession (proxy) — unconfigured Supabase, fail closed", () => {
  beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  afterAll(() => {
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it.each(["/profile", "/bookings", "/favorites", "/favorites/anything"])(
    "redirects unauthenticated requests to %s toward /login with a redirect param",
    async (path) => {
      const response = await updateSession(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("redirect")).toBe(path);
    }
  );

  it.each(["/", "/explore", "/courts/1", "/login", "/signup"])(
    "does not redirect public paths like %s",
    async (path) => {
      const response = await updateSession(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).not.toBe(307);
    }
  );

  it("does not redirect a path that merely starts with a protected prefix as a different segment", async () => {
    // /favoritesomething should not be treated as /favorites/*
    const response = await updateSession(new NextRequest("http://localhost:3000/favoritesomething"));
    expect(response.status).not.toBe(307);
  });
});

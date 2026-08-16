import { uploadCourtImage, deleteCourtImage, listImagesForVenue, buildImageStoragePath } from "@/lib/services/images";
import { createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { CourtImage } from "@/lib/supabase/types";

const imageRow: CourtImage = {
  id: "image-1",
  venue_id: "venue-1",
  court_id: null,
  storage_path: "venue-1/abc-photo.jpg",
  alt_text: null,
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
};

describe("buildImageStoragePath", () => {
  it("puts a venue-level photo directly under the venue id", () => {
    const path = buildImageStoragePath("venue-1", null, "My Photo.jpg");
    expect(path).toMatch(/^venue-1\/[0-9a-f-]+-My_Photo\.jpg$/);
  });

  it("nests a court-level photo one level deeper — same first path segment, so the same storage RLS policy covers both", () => {
    const path = buildImageStoragePath("venue-1", "court-1", "photo.png");
    expect(path.startsWith("venue-1/courts/court-1/")).toBe(true);
  });

  it("strips characters that aren't safe path segments", () => {
    const path = buildImageStoragePath("venue-1", null, "../../etc/passwd");
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc/passwd");
  });
});

function fakeUploadClient(opts: { uploadError?: unknown; insertResult?: { data: unknown; error: unknown } }) {
  const uploadMock = jest.fn().mockResolvedValue({ error: opts.uploadError ?? null });
  const fromTableMock = jest.fn(() => ({
    insert: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue(opts.insertResult ?? { data: imageRow, error: null }),
      })),
    })),
  }));
  return {
    storage: { from: jest.fn(() => ({ upload: uploadMock })) },
    from: fromTableMock,
    uploadMock,
    fromTableMock,
  } as never;
}

describe("uploadCourtImage", () => {
  const file = new File(["binary"], "photo.jpg", { type: "image/jpeg" });

  it("uploads the binary to Storage, then inserts the court_images row pointing at it", async () => {
    const supabase = fakeUploadClient({ insertResult: { data: imageRow, error: null } });

    const result = await uploadCourtImage(supabase, { venueId: "venue-1", courtId: null, file });

    expect(result).toEqual(imageRow);
    expect((supabase as unknown as { uploadMock: jest.Mock }).uploadMock).toHaveBeenCalledTimes(1);
    expect((supabase as unknown as { fromTableMock: jest.Mock }).fromTableMock).toHaveBeenCalledWith("court_images");
  });

  it("propagates a Storage upload failure without attempting the row insert", async () => {
    const supabase = fakeUploadClient({ uploadError: { message: "quota exceeded" } });

    await expect(uploadCourtImage(supabase, { venueId: "venue-1", courtId: null, file })).rejects.toMatchObject({
      message: "quota exceeded",
    });
    expect((supabase as unknown as { fromTableMock: jest.Mock }).fromTableMock).not.toHaveBeenCalled();
  });

  it("propagates a row-insert failure (e.g. RLS rejection for a venue the caller doesn't own)", async () => {
    const supabase = fakeUploadClient({ insertResult: { data: null, error: postgrestError("42501") } });

    await expect(uploadCourtImage(supabase, { venueId: "venue-1", courtId: null, file })).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("listImagesForVenue", () => {
  it("lists every image for a venue, ordered by sort_order", async () => {
    const supabase = createMockSupabase({ data: [imageRow], error: null });
    await expect(listImagesForVenue(supabase, "venue-1")).resolves.toEqual([imageRow]);
  });
});

describe("deleteCourtImage", () => {
  function fakeDeleteClient(opts: { deleteRowError?: unknown; removeObjectError?: unknown }) {
    const removeMock = jest.fn().mockResolvedValue({ error: opts.removeObjectError ?? null });
    const deleteRowResult = opts.deleteRowError
      ? { data: null, error: opts.deleteRowError }
      : { data: { storage_path: imageRow.storage_path }, error: null };
    return {
      from: jest.fn(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => ({
            select: jest.fn(() => ({
              single: jest.fn().mockResolvedValue(deleteRowResult),
            })),
          })),
        })),
      })),
      storage: { from: jest.fn(() => ({ remove: removeMock })) },
      removeMock,
    } as never;
  }

  it("deletes the row, then removes the Storage object at the path that row pointed to", async () => {
    const supabase = fakeDeleteClient({});

    await deleteCourtImage(supabase, "image-1");

    expect((supabase as unknown as { removeMock: jest.Mock }).removeMock).toHaveBeenCalledWith([imageRow.storage_path]);
  });

  it("propagates an RLS rejection deleting the row without ever touching Storage", async () => {
    const supabase = fakeDeleteClient({ deleteRowError: postgrestError("42501") });

    await expect(deleteCourtImage(supabase, "image-1")).rejects.toMatchObject({ code: "42501" });
    expect((supabase as unknown as { removeMock: jest.Mock }).removeMock).not.toHaveBeenCalled();
  });

  it("propagates a Storage removal failure after the row is already gone", async () => {
    const supabase = fakeDeleteClient({ removeObjectError: { message: "object not found" } });

    await expect(deleteCourtImage(supabase, "image-1")).rejects.toMatchObject({ message: "object not found" });
  });
});

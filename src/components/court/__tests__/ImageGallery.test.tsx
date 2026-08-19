import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImageGallery } from "../ImageGallery";

// PhotoLightbox pulls in a dialog/portal stack that isn't the point of
// this test (only the skeleton-while-loading behavior is) — same
// isolation approach BookingWidget's own tests use for PlayerPicker.
jest.mock("../../shared/PhotoLightbox", () => ({ PhotoLightbox: () => null }));

const IMAGE = { url: "https://example.com/photo.jpg", alt: "AIR/Rally Club court" };

describe("ImageGallery — loading skeleton", () => {
  it("shows a skeleton behind the desktop hero photo before it loads, then removes it once loaded", async () => {
    render(<ImageGallery images={[IMAGE]} venueName="AIR/Rally Club" fallbackSurfaceColor="teal" indoor={false} />);

    // Two <img>s render for one photo (the sm:hidden mobile carousel and
    // the desktop single-photo view both exist in the DOM at once —
    // Tailwind's responsive classes hide one visually, not remove it).
    // Only the desktop one carries a skeleton (this fix's target); firing
    // load on every match and asserting the skeleton is gone verifies the
    // real behavior without depending on DOM ordering between the two.
    const images = screen.getAllByAltText(IMAGE.alt);

    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);

    images.forEach((img) => fireEvent.load(img));

    // next/image invokes onLoad from a native 'load' listener rather than
    // through React's synthetic event system, so the resulting state
    // update doesn't always flush synchronously within fireEvent's own
    // act() wrapping — waitFor gives it a tick rather than asserting on a
    // stale DOM snapshot.
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
    });
  });

  it("renders the illustrated fallback, with no skeleton at all, when the venue has no real photos", () => {
    render(<ImageGallery images={[]} venueName="AIR/Rally Club" fallbackSurfaceColor="teal" indoor={false} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
});

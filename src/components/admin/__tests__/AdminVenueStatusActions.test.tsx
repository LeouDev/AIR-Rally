import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminVenueStatusActions } from "../AdminVenueStatusActions";
import { setVenueStatusAdminAction } from "../../../lib/actions/adminVenues";

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../lib/actions/adminVenues", () => ({
  setVenueStatusAdminAction: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockSetStatus = setVenueStatusAdminAction as jest.Mock;

/**
 * The condition under test is "requires confirmation whenever unlinked
 * candidates exist" — new logic wearing an already-shipped Dialog
 * component's clothes. A click-through of the dialog rendering correctly
 * would prove the component works; it would NOT prove this condition
 * actually gates on candidate count, which is the thing that closes (or
 * silently reopens) the venue-request notification trap from
 * [[venue-request-notify-is-manual-only]]. So this asserts both
 * directions: confirmation required with candidates present, not
 * required with zero — a test that would pass against the pre-change
 * "Approve goes straight through" code is not evidence, only the
 * zero-candidate case would.
 */
describe("AdminVenueStatusActions — approve gate on pending request candidates", () => {
  beforeEach(() => {
    mockSetStatus.mockReset();
    mockSetStatus.mockResolvedValue({ success: true, data: undefined });
  });

  it("requires confirmation before approving when unlinked candidates exist", async () => {
    render(
      <AdminVenueStatusActions venueId="venue-1" venueName="Sunbeam Courts" status="pending_review" pendingRequestCount={3} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    // The action must NOT have fired yet — clicking the trigger only opens
    // the dialog, exactly like Suspend's existing confirm step.
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/3 players have asked for this venue/i)).toBeInTheDocument();
    expect(screen.getByText(/only notifies a requester when a venue goes active/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Approve anyway/i }));
    expect(mockSetStatus).toHaveBeenCalledWith("venue-1", "active");
  });

  it("does not require confirmation when there are zero unlinked candidates", async () => {
    render(<AdminVenueStatusActions venueId="venue-1" venueName="Sunbeam Courts" status="pending_review" pendingRequestCount={0} />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    // No dialog text should ever appear — the click itself is the approval.
    expect(screen.queryByText(/have asked for this venue/i)).not.toBeInTheDocument();
    expect(mockSetStatus).toHaveBeenCalledWith("venue-1", "active");
  });

  it("does not require confirmation when pendingRequestCount is omitted (defaults to zero)", async () => {
    render(<AdminVenueStatusActions venueId="venue-1" venueName="Sunbeam Courts" status="pending_review" />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(mockSetStatus).toHaveBeenCalledWith("venue-1", "active");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymongoOnboardingCard } from "../PaymongoOnboardingCard";
import { startPaymongoOnboardingAction } from "../../../lib/actions/venueOnboarding";

// jest.mock must use a relative path here, not the `@/` alias — see
// MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../../../lib/actions/venueOnboarding", () => ({
  startPaymongoOnboardingAction: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const mockStartOnboarding = startPaymongoOnboardingAction as jest.MockedFunction<typeof startPaymongoOnboardingAction>;

describe("PaymongoOnboardingCard", () => {
  beforeEach(() => {
    mockStartOnboarding.mockReset();
  });

  it("shows a 'Connect PayMongo' CTA when unlinked", () => {
    render(<PaymongoOnboardingCard venueId="venue-1" activationStatus="unlinked" declinedReason={null} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect PayMongo" })).toBeInTheDocument();
  });

  it("shows a verifying state with a resume button for pending/under_review", () => {
    render(<PaymongoOnboardingCard venueId="venue-1" activationStatus="pending" declinedReason={null} />);
    expect(screen.getByText("Verifying")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume verification" })).toBeInTheDocument();
  });

  it("shows a connected, no-action state when activated", () => {
    render(<PaymongoOnboardingCard venueId="venue-1" activationStatus="activated" declinedReason={null} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the decline reason and no retry action when declined", () => {
    render(<PaymongoOnboardingCard venueId="venue-1" activationStatus="declined" declinedReason="KYC failed" />);
    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("KYC failed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls startPaymongoOnboardingAction with the venue id when 'Connect PayMongo' is clicked", async () => {
    mockStartOnboarding.mockResolvedValue({ success: true, data: { verificationUrl: "https://paymongo.test/verify" } });

    render(<PaymongoOnboardingCard venueId="venue-42" activationStatus="unlinked" declinedReason={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect PayMongo" }));

    expect(mockStartOnboarding).toHaveBeenCalledWith("venue-42");
  });
});

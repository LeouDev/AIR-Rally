import { render, screen } from "@testing-library/react";
import { BookingRefundStatus } from "../BookingRefundStatus";

describe("BookingRefundStatus", () => {
  it("shows 'Refund processing' for a pending refund, no amount", () => {
    render(<BookingRefundStatus status="pending" amount={50000} currency="PHP" />);
    expect(screen.getByText("Refund processing")).toBeInTheDocument();
    expect(screen.queryByText("₱500.00")).not.toBeInTheDocument();
  });

  it("shows 'Refund completed' with the amount for a succeeded refund", () => {
    render(<BookingRefundStatus status="succeeded" amount={50000} currency="PHP" />);
    expect(screen.getByText("Refund completed")).toBeInTheDocument();
    expect(screen.getByText("₱500.00")).toBeInTheDocument();
  });

  it("never exposes the internal 'provider_unavailable' reason — shows a generic contact-support label instead", () => {
    render(<BookingRefundStatus status="provider_unavailable" amount={50000} currency="PHP" />);
    expect(screen.getByText("Refund unavailable — contact support")).toBeInTheDocument();
    expect(screen.queryByText(/qrph/i)).not.toBeInTheDocument();
  });

  it("shows the same generic contact-support label for a failed refund — never a raw PayMongo error", () => {
    render(<BookingRefundStatus status="failed" amount={50000} currency="PHP" />);
    expect(screen.getByText("Refund unavailable — contact support")).toBeInTheDocument();
  });
});

/**
 * FROZEN LEGAL TEXT — NEVER EDIT ANY DOCUMENT IN THIS FILE.
 *
 * Every entry is a version of a document that users have already accepted.
 * Their acceptance rows in `agreement_acceptances` name these versions, and
 * a version string is worth nothing if the text behind it can change — the
 * whole point is that "you accepted 2026-08-17" remains answerable years
 * later.
 *
 * This exists because it already failed once. Terms §7 was corrected in the
 * mobile repo and never in this one, so the deployed site promised users a
 * credit refund the code refuses to give. Fixing that text (commit c5e0c07)
 * would itself have destroyed the superseded wording had it not been
 * recovered from git and frozen here.
 *
 * TO CHANGE A DOCUMENT: add a NEW version. Do not edit an existing one.
 * legalVersions.test.ts hashes every entry against a committed manifest and
 * fails if any changes, so an in-place edit cannot reach production — human
 * review demonstrably did not catch the last one.
 *
 * reviewNote fields are deliberately absent: they are questions for counsel,
 * hidden from the public pages, and never part of what a user accepted.
 */
import type { LegalDocument } from "@/lib/legalContent";

/** Terms as they stood from 2026-08-17 until 2026-08-23. All 7 production acceptances name this version. */
export const TERMS_2026_08_17: LegalDocument = {
  title: "User Agreement",
  intro: [
    "AIR/Rally is an online marketplace for discovering and booking pickleball courts in the Philippines. These terms govern your use of air-rally.com and any AIR/Rally application.",
    "By creating an account, you accept this agreement. If you do not accept it, do not create an account or make a booking.",
  ],
  sections: [
    {
      heading: "1. What AIR/Rally is, and what it is not",
      body: [
        "AIR/Rally connects players with venues that operate pickleball courts. Venues are independent businesses. They own and control their courts, set their own prices and opening hours, and are responsible for the condition, safety, staffing and lawful operation of their facilities.",
        "When you book, your agreement to use the court is with the venue. AIR/Rally is not the operator of the court, not a party to that agreement, and does not supervise play. AIR/Rally's role is to list availability, take the booking, collect payment, and give both sides a record of it.",
      ],
    },
    {
      heading: "2. Your account",
      body: [
        "You must be able to enter a binding contract to hold an account. You are responsible for what happens under your account and for keeping your password private.",
        "You give a first name, last name and email address at signup. You may add a display name, a profile photo and a phone number. Your display name and profile photo are visible to other users.",
        "Accounts begin as player accounts. Becoming a venue owner requires submitting an application and being approved by AIR/Rally; you cannot grant yourself venue-owner or administrator access.",
      ],
    },
    {
      heading: "3. Booking a court",
      body: [
        "A booking is held from the moment it is created and becomes confirmed once payment succeeds. A court cannot be double-booked: the first booking to take a time slot holds it, including while payment is still pending.",
        "Bookings must start at least 30 minutes in the future and may run up to 4 hours. Availability shown reflects the venue's stated opening hours and any periods the venue has blocked.",
        "You will receive a confirmation code once your booking is confirmed. Bring it, or be prepared to identify yourself, when you arrive.",
      ],
    },
    {
      heading: "4. Prices, payment and fees",
      body: [
        "Prices are set by the venue and shown in Philippine Pesos before you pay. The price shown at checkout is the price you pay.",
        "AIR/Rally charges venues a platform fee of 5% of the booking value. This fee is taken from the venue's share and is not added on top of the price you see.",
        "Payments are processed by PayMongo, a licensed Philippine payment provider. AIR/Rally never receives or stores your card number, bank credentials or e-wallet credentials. AIR/Rally records only the payment reference identifiers PayMongo returns, so a booking can be matched to its payment.",
        "A booking is only treated as paid when PayMongo confirms the payment to AIR/Rally directly. A payment page that appears to succeed is not itself proof of payment.",
      ],
    },
    {
      heading: "5. Cancellations",
      body: [
        "If you cancel at least 48 hours before your booking starts, you are eligible for compensation in AIR/Rally Credits. If you cancel inside that window, you are not.",
        "If the venue cancels, if the court becomes unavailable, or if a system or payment error is at fault, you are compensated in full regardless of how close to the start time it happens, because none of that is your doing.",
        "Compensation is issued as AIR/Rally Credits rather than a return of funds to your original payment method.",
      ],
    },
    {
      heading: "6. Rescheduling",
      body: [
        "A confirmed booking may be rescheduled while its start time is more than 24 hours away, subject to the new slot being available.",
        "If the new slot costs more, you pay the difference before the reschedule completes. A reschedule is only final once any additional payment succeeds.",
      ],
    },
    {
      heading: "7. AIR/Rally Credits",
      body: [
        "Credits are a balance held in your AIR/Rally account that can be applied against future bookings on the platform.",
        "Credits are not money, not legal tender, and not redeemable for cash. They cannot be transferred to another person or sold. They are issued at AIR/Rally's discretion, principally as compensation under the cancellation terms above.",
        "Credits applied to a booking reduce the amount you pay at checkout. Where a booking paid partly with Credits is later cancelled, the Credits portion is returned to your Credits balance.",
      ],
    },
    {
      heading: "8. Venue owners",
      body: [
        "Venue owners must be approved before listing. Listings are reviewed before they become visible to players, and AIR/Rally may suspend a listing.",
        "By listing, you confirm you are entitled to offer the courts for hire, that your descriptions, photographs, prices and opening hours are accurate, and that you will honour bookings made through the platform.",
        "You are responsible for the safety and lawful operation of your facility, including any permits, insurance and staffing that requires.",
        "Amounts owed to you for confirmed bookings are recorded against your venue as they are earned. AIR/Rally will notify you of the settlement process and timetable separately; automated payouts are not yet operating.",
      ],
    },
    {
      heading: "9. Open Play and shared costs",
      body: [
        "A player may book a court and invite others to join. The organiser is the person who books and pays for the court, and is the only person AIR/Rally charges.",
        "Splitting that cost between players is entirely a matter between those players. AIR/Rally does not collect, hold, transfer or guarantee any share, and takes no part in disputes about who owes whom.",
      ],
    },
    {
      heading: "10. Community content",
      body: [
        "COURT/Side posts, comments, club pages, event listings, reviews and uploaded photographs are created by users, not by AIR/Rally.",
        "You keep ownership of what you post. You grant AIR/Rally a non-exclusive, royalty-free licence to store, display and distribute it within the platform for the purpose of operating the service.",
        "Post only what you have the right to post. Do not post anything unlawful, harassing, hateful, sexually explicit, violent, deceptive, or that impersonates another person. Do not post other people's personal information.",
        "Reviews may only be written for bookings you actually made and completed.",
        "Content you upload as an image is stored in publicly readable storage. Anyone holding the direct link can view it, whether or not they have an AIR/Rally account. Do not upload anything you would not want to be publicly accessible.",
      ],
    },
    {
      heading: "11. Reports and moderation",
      body: [
        "You can report a post, comment, club, event or player. Reports are private: the person reported is not told who reported them.",
        "AIR/Rally may remove content, suspend accounts or refuse service where these terms are broken. A moderation record is kept even after the content it concerns is deleted.",
        "To keep the platform usable, limits apply to how frequently content can be created — posts and comments per hour, clubs and reports per day.",
      ],
    },
    {
      heading: "12. Suspension and closing your account",
      body: [
        "You may stop using AIR/Rally at any time.",
        "AIR/Rally may suspend or close an account that breaches these terms, that is used unlawfully, or where necessary to protect other users or the platform.",
        "Closing an account does not cancel confirmed bookings or extinguish amounts already owed either way.",
      ],
    },
    {
      heading: "13. Disclaimers",
      body: [
        "AIR/Rally provides the platform as it is. Availability, descriptions and photographs come from venues, and AIR/Rally does not warrant that they are complete or accurate.",
        "AIR/Rally does not inspect courts, does not supervise play, and is not responsible for injury, loss or damage arising from your use of a venue's facilities. Sport carries risk; you play at your own risk.",
        "AIR/Rally does not guarantee uninterrupted or error-free operation of the platform.",
      ],
    },
    {
      heading: "14. Limitation of liability",
      body: [
        "To the fullest extent Philippine law allows, AIR/Rally is not liable for indirect or consequential loss, or for loss of profit, arising from your use of the platform.",
        "Nothing in these terms limits liability that cannot lawfully be limited, including for death or personal injury caused by negligence, or for fraud.",
      ],
    },
    {
      heading: "15. Changes to these terms",
      body: [
        "These terms may change as the platform develops. The version you accepted is recorded against your account at signup.",
        "Material changes will be notified in the platform. Continuing to use AIR/Rally after a change takes effect means you accept the updated terms.",
      ],
    },
    {
      heading: "16. Governing law",
      body: [
        "These terms are governed by the laws of the Republic of the Philippines, and the courts of the Philippines have jurisdiction over any dispute.",
      ],
    },
    {
      heading: "17. Contact",
      body: [
        "Questions about these terms can be raised through the support page in your AIR/Rally account. Replies are delivered as in-app notifications.",
      ],
    },
  ],
};

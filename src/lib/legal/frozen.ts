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

/**
 * The Venue Owner Agreement as it stood at version 1.0, superseded by 1.1
 * on 2026-08-26 when the weekly payout clauses (3.9-3.12) were added and
 * 3.6's fifteen-banking-day window was replaced.
 *
 * THIS IS THE FIRST FROZEN ENTRY THAT SERVES A REAL ACCEPTANCE ROW. The
 * founder's own owner application on production names version 1.0; without
 * this it would point at a bare string with no readable text behind it.
 *
 * Two facts a future reader will want and cannot reconstruct:
 *
 *   NOTICE. Clause 3.8 requires 30 days' written notice for a commission
 *   change. The 1.1 amendment adds a per-transfer deduction rather than
 *   changing the commission, and at the time of the change the only
 *   approved venue owner was the founder's own test account — so there was
 *   nobody to notify. That reasoning expires the moment a real owner
 *   exists.
 *
 *   NO MIRROR. Unlike the Terms and the Privacy Policy, the Venue Owner
 *   Agreement exists only in this repository — the mobile app carries no
 *   copy. It is the one legal document that cannot drift between repos.
 */
export const OWNER_AGREEMENT_1_0: LegalDocument = {
  title: "Venue Owner Agreement",
  intro: [
    "This agreement is between AIR/Rally and you, the venue owner or authorised operator, and covers every venue and court you list with us.",
    "The five things that matter most: AIR/Rally keeps 5% of the court price, you receive 95%. The processing fee is paid by the customer, on top, and never reduces your share. Payouts are arranged by bank transfer within 15 banking days after the court time has been played. A confirmed booking is a commitment — the player has already paid. If a player cancels 48+ hours ahead, AIR/Rally compensates them, not you.",
  ],
  sections: [
    {
      heading: "1. Who we are to each other",
      body: [
        '1.1 This agreement is between AIR/Rally ("the Platform", "we") and you, the venue owner or authorised operator ("the Venue", "you").',
        "1.2 AIR/Rally is a marketplace. You provide the court and the service. We provide the platform where players find you, book, and pay. We do not operate your venue, do not employ your staff, and are not a party to the games played there.",
        "1.3 This covers every venue and court you list with us.",
        "1.4 We are an early-stage company. Some parts of the platform are still being built, and we will tell you plainly which — see clause 3.6.",
      ],
    },
    {
      heading: "2. Getting listed",
      body: [
        "2.1 Venue owner access is granted by us after review. You cannot approve yourself.",
        "2.2 Before your venue can accept bookings, seven things must be complete: business information; address; at least one active court; a price above ₱0 on every active court; at least one operating-hours window; our approval; and your payout bank details.",
        "2.3 A venue with no operating hours set shows as closed every day and cannot be booked. This catches people out — set your hours first.",
        "2.4 We may decline a listing, or suspend one later, if it breaches this agreement, raises safety concerns, or we are legally required to. We will tell you why and give you 7 days' notice unless the concern is urgent.",
      ],
    },
    {
      heading: "3. Money",
      body: [
        "3.1 Commission. We charge 5% of the court price. You keep 95%.",
        "3.2 Worked example: a ₱400.00 court price plus a ₱6.09 payment processing fee means the customer pays ₱406.09. AIR/Rally's 5% commission (₱20.00) is taken from the ₱400.00 court price, so you receive ₱380.00.",
        "3.3 The processing fee is the customer's. It is added on top of your price and does not reduce what you receive.",
        '3.4 "Paid" does not mean "paid to you." When a booking shows as Paid, it means the customer\'s payment succeeded. It does not mean money has reached your account yet.',
        "3.5 When you get paid. Earnings become payable once the booked court time has been played — not when it is booked, and not when the customer pays.",
        "3.6 How you get paid. By bank transfer to the account on file, within 15 banking days of the court time being played. Automated payouts are not live yet, so transfers are arranged manually. If that ever changes, you will keep getting paid at least as fast.",
        "3.7 Your bank details. You are responsible for keeping them correct. We cannot recover funds sent to an account you gave us in error, though we will help you try.",
        "3.8 Changing the commission. We may change it with 30 days' written notice. Bookings already confirmed keep the rate that applied when they were made.",
      ],
    },
    {
      heading: "4. What we expect from you",
      body: [
        "4.1 Honour every confirmed booking. The player has paid and is entitled to the court at that time.",
        "4.2 Keep your listing accurate — prices, hours, court details, amenities, photos.",
        "4.3 Keep your courts safe and playable, with the surface, lighting, and facilities you advertise.",
        "4.4 Be reachable and present when a booking starts.",
        "4.5 Block time in the calendar before someone books it.",
        "4.6 Comply with Philippine law — your business registration, permits, taxes, and safety requirements are yours to handle.",
      ],
    },
    {
      heading: "5. Insurance and safety",
      body: [
        "5.1 You control the premises, so safety at your venue is your responsibility — including injuries to players, their guests, and your staff.",
        "5.2 We strongly recommend you carry public liability insurance. Pickleball is a physical sport on a hard surface; injuries happen even at well-run venues.",
        "5.3 When you list, you will tell us whether you carry it. If you do not, you confirm you accept responsibility for incidents at your venue.",
        "5.4 AIR/Rally does not insure your venue, your courts, or the people using them.",
      ],
    },
    {
      heading: "6. Cancellations",
      body: [
        "6.1 By the player. A player cancelling 48 hours or more before the start receives AIR/Rally Credits. Those credits are our cost, not yours. Inside 48 hours, they receive nothing.",
        "6.2 Credits never expire. A booking paid entirely with credits cannot be cancelled.",
        "6.3 By you. Please avoid it. If you must, tell us and the player immediately. We compensate the player in full regardless of timing, because the failure was not theirs. Repeated cancellations may lead to suspension.",
        "6.4 Rescheduling. Players may reschedule up to 24 hours before the start, subject to your availability.",
        "6.5 Processing fees are never refunded, to anyone.",
      ],
    },
    {
      heading: "7. Reviews",
      body: [
        "7.1 Players who complete a booking may leave a public review.",
        "7.2 We will not remove a review simply because it is unfavourable. We do remove reviews that are abusive, false, or breach our content rules.",
        "7.3 Do not offer discounts, freebies, or anything else in exchange for positive reviews.",
      ],
    },
    {
      heading: "8. Customer information",
      body: [
        "8.1 You receive only what you need to deliver the booking — the player's name, the time, the court, and the confirmation code.",
        "8.2 Use it only for that booking. No marketing lists, no sharing, no selling.",
        "8.3 Anything you collect separately at your venue is yours to handle, under the Data Privacy Act.",
      ],
    },
    {
      heading: "9. Limits of our responsibility",
      body: [
        "9.1 We are responsible for running the platform, taking payments correctly, and paying you what you are owed.",
        "9.2 We are not responsible for what happens at your venue, including injury, loss, or damage to people or property.",
        "9.3 If something goes wrong on our side, our total liability to you is limited to the commission we received from you over the previous 3 months.",
        "9.4 Neither of us is liable to the other for lost profits or indirect losses.",
      ],
    },
    {
      heading: "10. Ending this agreement",
      body: [
        "10.1 You may leave at any time with 14 days' notice, but you must honour bookings already confirmed.",
        "10.2 We may suspend or remove your listing for breach of this agreement, safety concerns, repeated cancellations, or fraud — with notice and a chance to respond, unless the issue is urgent.",
        "10.3 If either of us ends this, bookings already confirmed must still be honoured, or the players compensated in full.",
        "10.4 Money owed for court time already played remains payable.",
      ],
    },
    {
      heading: "11. General",
      body: [
        "11.1 This agreement is governed by the laws of the Republic of the Philippines.",
        "11.2 Our payment provider is regulated by the Bangko Sentral ng Pilipinas. Consumers may raise concerns with the BSP Financial Consumer Protection Department.",
        "11.3 We may update this agreement with 30 days' notice. Continuing to list means you accept the update.",
        "11.4 Nothing here makes us partners, employer and employee, or agents of one another.",
        "11.5 If we disagree, we will try to sort it out directly first. If we cannot, Philippine courts have jurisdiction.",
      ],
    },
  ],
};

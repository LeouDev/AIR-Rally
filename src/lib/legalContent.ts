/**
 * The actual text of the User Agreement and Privacy Policy.
 *
 * Kept here, as structured data, rather than as JSX inside each page, so
 * that /terms, /privacy and the PDF generated for counsel
 * (scripts/generate-legal-pdf.ts) all render the SAME words. A legal
 * document that says one thing on the site and another in the file sent
 * to a lawyer is worse than having none.
 *
 * IMPORTANT: this text is written to describe what AIR/Rally actually
 * does today — every clause below was checked against the schema, the
 * booking config constants and the payment code. It has NOT been reviewed
 * by a lawyer. Anything a reviewer needs to decide is marked with
 * `reviewNote`, which renders as a visible flag in the PDF and is hidden
 * on the public pages.
 */

export type LegalSection = {
  heading: string;
  /** Each string is one paragraph. */
  body: string[];
  /** A question for the reviewing lawyer. PDF only — never shown on the site. */
  reviewNote?: string;
};

export type LegalDocument = {
  title: string;
  intro: string[];
  sections: LegalSection[];
};

const PLATFORM_FEE_DISPLAY = "5%";
const CANCELLATION_WINDOW = "48 hours";
const RESCHEDULE_WINDOW = "24 hours";

export const TERMS: LegalDocument = {
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
      reviewNote:
        "Confirm this characterisation holds under Philippine law given AIR/Rally collects payment into its own PayMongo account before any venue settlement exists. A regulator may view collecting funds as more than pure intermediation.",
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
        `AIR/Rally charges venues a platform fee of ${PLATFORM_FEE_DISPLAY} of the booking value. This fee is taken from the venue's share and is not added on top of the price you see.`,
        "Payments are processed by PayMongo, a licensed Philippine payment provider. AIR/Rally never receives or stores your card number, bank credentials or e-wallet credentials. AIR/Rally records only the payment reference identifiers PayMongo returns, so a booking can be matched to its payment.",
        "A booking is only treated as paid when PayMongo confirms the payment to AIR/Rally directly. A payment page that appears to succeed is not itself proof of payment.",
      ],
      reviewNote:
        "Funds are currently collected into AIR/Rally's own PayMongo account. Automated venue settlement is NOT live: no money has moved to any venue through the platform. Counsel should advise whether holding venue funds requires specific disclosure, trust/escrow arrangements, or BSP considerations, and whether the venue contract needs to state the settlement timetable.",
    },
    {
      heading: "5. Cancellations",
      body: [
        `If you cancel at least ${CANCELLATION_WINDOW} before your booking starts, you are eligible for compensation in AIR/Rally Credits. If you cancel inside that window, you are not.`,
        "If the venue cancels, if the court becomes unavailable, or if a system or payment error is at fault, you are compensated in full regardless of how close to the start time it happens, because none of that is your doing.",
        "Compensation is issued as AIR/Rally Credits rather than a return of funds to your original payment method.",
      ],
      reviewNote:
        "This is the clause most likely to need change. Compensating in Credits rather than cash may not satisfy the Consumer Act of the Philippines (RA 7394) or DTI rules where the failure is the venue's or the platform's. Counsel should confirm whether a cash refund must be offered, at minimum where the customer is not at fault, and whether the 48-hour cutoff is enforceable.",
    },
    {
      heading: "6. Rescheduling",
      body: [
        `A confirmed booking may be rescheduled while its start time is more than ${RESCHEDULE_WINDOW} away, subject to the new slot being available.`,
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
      reviewNote:
        "Counsel should confirm whether a stored balance of this kind attracts stored-value, e-money or gift-cheque regulation in the Philippines, and whether an expiry period is permitted or required. Credits currently do not expire.",
    },
    {
      heading: "8. Venue owners",
      body: [
        "Venue owners must be approved before listing. Listings are reviewed before they become visible to players, and AIR/Rally may suspend a listing.",
        "By listing, you confirm you are entitled to offer the courts for hire, that your descriptions, photographs, prices and opening hours are accurate, and that you will honour bookings made through the platform.",
        "You are responsible for the safety and lawful operation of your facility, including any permits, insurance and staffing that requires.",
        "Amounts owed to you for confirmed bookings are recorded against your venue as they are earned. AIR/Rally will notify you of the settlement process and timetable separately; automated payouts are not yet operating.",
      ],
      reviewNote:
        "Venue owners currently accept only these consumer-facing terms. Counsel should advise whether a separate venue/merchant agreement is required covering settlement timing, commission, liability allocation, insurance requirements, indemnity and termination.",
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
      reviewNote:
        "The public-storage disclosure in the final paragraph is factually accurate and deliberately blunt. Counsel may wish to strengthen it, or the product may prefer to make the buckets private and serve signed URLs instead.",
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
      reviewNote:
        "Self-service account deletion is not yet built. Counsel should advise on the required response time for an erasure request under the Data Privacy Act and what must be retained despite one (booking and payment records in particular).",
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
      reviewNote:
        "The monetary cap is deliberately left blank pending advice. Counsel should propose an enforceable cap (commonly the value of the booking concerned, or fees paid over a preceding period) and confirm it survives RA 7394.",
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
      reviewNote: "Confirm the appropriate venue clause and whether arbitration or mediation should be required first.",
    },
    {
      heading: "17. Contact",
      body: [
        "Questions about these terms can be raised through the support page in your AIR/Rally account. Replies are delivered as in-app notifications.",
      ],
      reviewNote:
        "A published business name, registered address and contact email will be required before launch. In-app-only contact is unlikely to satisfy consumer or data-protection expectations.",
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: "Privacy Policy",
  intro: [
    "This policy explains what personal information AIR/Rally collects when you use air-rally.com, why, who can see it, and what rights you have over it.",
    "It is written to reflect how the platform actually works today.",
  ],
  sections: [
    {
      heading: "1. Who is responsible for your information",
      body: [
        "AIR/Rally operates the platform and decides how your personal information is handled. It is the personal information controller for the purposes of the Data Privacy Act of 2012 (RA 10173).",
      ],
      reviewNote:
        "The registered entity name and address must be inserted here. Counsel should also advise whether registration with the National Privacy Commission and appointment of a Data Protection Officer are required at current scale.",
    },
    {
      heading: "2. What we collect",
      body: [
        "Account information: your first name, last name, email address, and — if you provide them — a display name, profile photograph and phone number. We also generate a referral code for your account.",
        "Booking information: the courts and times you book, the price, the status of the booking, your confirmation code, and any cancellation or rescheduling.",
        "Payment information: the reference identifiers PayMongo returns for a payment, the amount, and whether it succeeded. We do not receive or store your card number, bank credentials or e-wallet credentials.",
        "Content you create: reviews, COURT/Side posts and comments, clubs and events you create or join, photographs you upload, who you follow, and posts you like or reshare.",
        "Support and safety information: support messages you send, and reports you file about other users or content.",
        "Technical information: standard server and security logs generated when your browser contacts the service.",
      ],
    },
    {
      heading: "3. Why we use it",
      body: [
        "To create and secure your account, to take and confirm bookings, to process payment through PayMongo, to show your bookings and history back to you, and to notify you about activity that concerns you.",
        "To let venues fulfil the bookings you make with them.",
        "To operate community features, to moderate reported content, and to enforce the limits and rules in the User Agreement.",
        "To keep records required for accounting, dispute handling and legal compliance.",
      ],
      reviewNote:
        "Counsel should map each purpose to a lawful basis under RA 10173 — contract, legitimate interest or consent — and confirm whether separate consent is needed for anything beyond performing the booking.",
    },
    {
      heading: "4. Who can see your information",
      body: [
        "Other players see your display name and profile photograph next to your posts, comments, reviews, club memberships and event attendance. They do not see your email address or phone number.",
        "A venue owner sees the display name of anyone who books their courts, together with the booking's time, court, status and value. This is how they know who is arriving.",
        "AIR/Rally administrators can see accounts, bookings, payments, reports and support messages in order to run the platform, resolve disputes and moderate content.",
        "Photographs you upload — profile, post, club and venue images — are stored in publicly readable storage. Anyone with the direct link can open them, including people without an AIR/Rally account and search engines that discover the link.",
        "Reports you file are not shown to the person you reported, and are not attributed to you anywhere they can see.",
      ],
      reviewNote:
        "The public image storage is the most significant privacy exposure in the product. It is disclosed here plainly, but counsel and the product team should decide whether profile and post images ought to be private with signed URLs instead.",
    },
    {
      heading: "5. Service providers and where your information is held",
      body: [
        "Supabase provides the database, authentication and file storage that hold your information. The database is located in South Korea.",
        "Vercel provides the hosting that serves the site. Server functions run in South Korea.",
        "PayMongo processes payments. When you pay, you interact with PayMongo directly and provide payment credentials to them, not to AIR/Rally.",
        "Because these providers operate outside the Philippines, your personal information is transferred to and stored in another country.",
      ],
      reviewNote:
        "Cross-border transfer to South Korea is a required disclosure under RA 10173 and needs the appropriate contractual safeguards with Supabase and Vercel. Counsel should confirm what documentation is required and whether the transfer must be described more specifically.",
    },
    {
      heading: "6. How long we keep it",
      body: [
        "Account information is kept while your account exists.",
        "Booking and payment records are kept after a booking finishes, because they are financial and dispute records.",
        "Moderation records are kept even after the content they concern has been deleted. A report deliberately outlives the post it describes, so that a record of what was reported and what was decided is not erased along with the content.",
      ],
      reviewNote:
        "Specific retention periods need to be set — particularly for financial records under BIR rules and for moderation records. None are currently defined in the product.",
    },
    {
      heading: "7. Your rights",
      body: [
        "Under the Data Privacy Act of 2012 you have rights to be informed about how your information is used, to access it, to correct it, to object to its processing, to have it erased or blocked in certain circumstances, to obtain a copy in a portable form, and to be indemnified for damage caused by misuse.",
        "You can change your name, display name, photograph and phone number yourself in your account settings.",
        "For any other request, contact us through the support page. Self-service data export and account deletion are not yet available; requests are handled manually.",
        "If you believe your rights have been infringed, you may complain to the National Privacy Commission.",
      ],
      reviewNote:
        "Manual handling of access and erasure requests is a compliance risk as user numbers grow. Counsel should confirm the statutory response deadline and advise when self-service tooling becomes necessary.",
    },
    {
      heading: "8. Location",
      body: [
        "If you allow it, your browser shares your approximate location so that venues can be sorted by distance from you. This is used for that search only and is not stored on our servers. You can refuse, and the rest of the platform still works.",
      ],
    },
    {
      heading: "9. Keeping information secure",
      body: [
        "Access to data is enforced in the database itself rather than only in the application, so that a request can only return the records the requesting account is entitled to see.",
        "Passwords are handled by Supabase authentication and are never visible to AIR/Rally.",
        "No system is perfectly secure. If a breach affects your personal information, we will act in accordance with the notification requirements of the Data Privacy Act.",
      ],
    },
    {
      heading: "10. Children",
      body: [
        "AIR/Rally is not intended for children. Accounts should be created by adults; a minor should use the platform only through a parent or guardian's account and with their supervision.",
      ],
      reviewNote:
        "No age verification exists at signup. Counsel should advise the minimum age to state and whether parental consent must be collected for players under it, given pickleball's appeal to families.",
    },
    {
      heading: "11. Changes to this policy",
      body: [
        "This policy may change as the platform develops. Material changes will be notified in the platform.",
      ],
    },
    {
      heading: "12. Contact",
      body: [
        "Privacy questions and requests can be raised through the support page in your AIR/Rally account. Replies are delivered as in-app notifications.",
      ],
      reviewNote:
        "A dedicated privacy contact address, and the Data Protection Officer's details if one is appointed, must be published here before launch.",
    },
  ],
};

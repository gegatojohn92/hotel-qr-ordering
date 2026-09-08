/**
 * AI Assistant Engine
 * Uses Gemini Flash via REST API to power the hotel AI concierge.
 * Falls back to a comprehensive built-in rule engine if the API key is absent or the request fails.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiChatMessage {
  role: 'user' | 'model'
  text: string
}

export interface AiGuestContext {
  roomNumber?: string
  hotelName?: string
  guestName?: string
  guestPhone?: string
  localTime?: string
  hour24?: number
}

export interface AiAssistantResponse {
  text: string
  shouldEscalate: boolean
  source: 'GEMINI' | 'RULE_FALLBACK'
}

// ─── Hotel Knowledge Base ─────────────────────────────────────────────────────

export const HOTEL_SYSTEM_PROMPT = `You are Kekehyu AI, the friendly, polished, and highly professional 5-star AI concierge for Kekehyu Hotel.
Your mission is to assist hotel guests with accurate, polite, and immediate information about rooms, amenities, dining, and hotel services.

== Hotel Policies & Information ==
- Check-in time: 2:00 PM | Check-out time: 12:00 PM (noon)
- Early check-in: Available upon request (subject to room availability, surcharge of 1,000 pesos)
- Late check-out: Available upon request (subject to room availability, surcharge of 1,000 pesos)
- WiFi Network: "KekehyuGuest" | Password: Provided on Keycard Jacket, or scan the QR code on the back of the keycard jacket
- Room service hours: 6:00 AM – 9:30 PM (Order directly via the digital menu in this app)
- Housekeeping: Daily service between 6:00 AM – 4:00 PM. Housekeeping desk available 24 hours for fresh towels & amenities
- Make up room: 6:00 AM – 4:00 PM upon guest request only
- Maintenance: 24 hours available via Front Desk

== Room Rates & Pricing ==
- Deluxe Single: 1,890 pesos (without breakfast) | 2,100 pesos (with breakfast, good for 1)
- Deluxe Queen: 2,940 pesos (without breakfast) | 3,250 pesos (with breakfast, good for 2)
- Deluxe Double: 3,360 pesos (without breakfast) | 3,700 pesos (with breakfast, good for 2)
- Deluxe Triple: 3,990 pesos (without breakfast) | 4,400 pesos (with breakfast, good for 3)
- Junior Executive: 4,850 pesos (without breakfast) | 5,350 pesos (with breakfast, good for 2)
- Presidential Suite: 6,900 pesos (without breakfast) | 7,600 pesos (with breakfast, good for 2)

== Dining & Beverages ==
- Restaurant "The Grand Table":
  - Breakfast: 6:30 AM – 10:30 AM
  - Lunch: 12:00 PM – 2:30 PM
  - Dinner: 6:00 PM – 10:00 PM
- In-Room Dining: Available from 6:00 AM – 9:30 PM via the in-app digital menu
- Pool Bar: 10:00 AM – 8:00 PM
- Complimentary: Mineral water bottles, tea, and coffee provided in all guest rooms (replenished daily or upon request)

== Spa & Wellness ==
- Kekehyu Spa: Open daily from 9:00 AM – 9:00 PM
- Bookings recommended; walk-ins subject to availability
- Massage Treatments & Prices:
  - Holistic Massage: 700 pesos / hour
  - Stone Massage: 900 pesos / hour
  - Foot Massage: 750 pesos
  - Spa 108 Package: 999 pesos
- Sauna: Open daily 6:00 AM – 10:00 PM at 250 pesos only

== Amenities & Facilities ==
- Fitness Center / Gym: 6:00 AM – 10:00 PM (equipped with cardio machines and free weights)
- Front Desk: 24 hours (Direct Phone: +639615794855 or Dial "0" from room phone)
- Maintenance: 24 hours available via Front Desk
- Laundry & Dry-Cleaning: Same-day service if submitted before 9:00 AM (ask front desk or housekeeping for laundry bag)
- Airport Shuttle / Transfer: Available upon request (48 hours advance notice preferred)
- Parking: Complimentary for registered hotel guests

== Billing & Payments ==
- Room charges settled at check-out unless pre-payment arranged
- Accepted payments: Cash, Credit/Debit Cards (Visa/Mastercard), Bank Transfer, GCash/Maya
- Service charge: 10% applies to dining and spa services

== Emergency & Assistance ==
- Front Desk Number: +639615794855
- Room Phone: Dial "0" for Front Desk / Operator
- Emergency Services: Dial "911" or contact Front Desk immediately

== Concierge Behavior Guidelines ==
- Warm, polite, elegant, and concise (hospitality tone).
- When asked if a facility/service is currently open, refer to the Current Time provided in the prompt context.
- Guide guests to appropriate app sections (In-room Dining, Spa Booking, Service Requests) when relevant.
- NEVER fabricate prices or policies. Quote exact rates given above.
- Never authorize room discounts or refunds directly; offer to connect with Front Desk.
- If a guest expresses urgency, frustration, or asks for a human, set escalate=true.
- Always respond in the language the guest uses (English, Tagalog/Filipino, etc.).`

// ─── Escalation Intent Classifier ────────────────────────────────────────────

const ESCALATION_PATTERNS = [
  /speak\s*(to|with)\s*(a\s*)?(human|staff|person|manager|supervisor|someone)/i,
  /connect\s*(me\s*)?(to|with)\s*(a\s*)?(human|staff|person|front\s*desk)/i,
  /front\s*desk/i,
  /transfer\s*(me|to)/i,
  /real\s*(person|staff|human)/i,
  /not\s*happy/i,
  /complaint/i,
  /this\s*is\s*(unacceptable|ridiculous|terrible)/i,
  /i\s*(demand|require|need)\s*(immediate|urgent)/i,
  /emergency/i,
  /urgent/i,
  /refund/i,
  /compensation/i,
  /escalat/i,
  /call\s*(the\s*)?(front\s*desk|reception|staff)/i,
]

export function detectEscalationIntent(message: string): boolean {
  return ESCALATION_PATTERNS.some((pattern) => pattern.test(message))
}

// ─── Fallback Rule Engine ─────────────────────────────────────────────────────

interface FallbackRule {
  patterns: RegExp[]
  response: (context?: AiGuestContext) => string
}

const FALLBACK_RULES: FallbackRule[] = [
  // 1. Room Rates & Pricing
  {
    patterns: [/room\s*(rate|price|cost|type|pricing)|how\s*much\s*(is\s*a\s*room|are\s*the\s*rooms)|deluxe|presidential|junior\s*exec/i],
    response: () =>
      `🏨 **Kekehyu Hotel Room Rates:**\n\n` +
      `• **Deluxe Single:** ₱1,890 (room only) | ₱2,100 (with breakfast, good for 1)\n` +
      `• **Deluxe Queen:** ₱2,940 (room only) | ₱3,250 (with breakfast, good for 2)\n` +
      `• **Deluxe Double:** ₱3,360 (room only) | ₱3,700 (with breakfast, good for 2)\n` +
      `• **Deluxe Triple:** ₱3,990 (room only) | ₱4,400 (with breakfast, good for 3)\n` +
      `• **Junior Executive:** ₱4,850 (room only) | ₱5,350 (with breakfast, good for 2)\n` +
      `• **Presidential Suite:** ₱6,900 (room only) | ₱7,600 (with breakfast, good for 2)\n\n` +
      `Would you like me to connect you with Front Desk (+639615794855) to check room availability or make a booking?`,
  },

  // 2. Spa, Massages & Packages
  {
    patterns: [/spa|massage|facial|wellness|holistic|stone\s*massage|foot\s*massage|spa\s*108/i],
    response: () =>
      `💆 **Kekehyu Spa & Massage Services** (Daily 9:00 AM – 9:00 PM):\n\n` +
      `• **Holistic Massage:** ₱700 / hour\n` +
      `• **Stone Massage:** ₱900 / hour\n` +
      `• **Foot Massage:** ₱750\n` +
      `• **Spa 108 Package:** ₱999\n\n` +
      `You can book appointments directly via the Spa section in this app or let me know your preferred time!`,
  },

  // 3. Sauna
  {
    patterns: [/sauna|steam/i],
    response: () =>
      `🧖 Our **Sauna** is open daily from **6:00 AM to 10:00 PM** at only **₱250**. Clean towels and shower facilities are provided. Would you like to visit today?`,
  },

  // 4. Gym / Fitness Center
  {
    patterns: [/gym|fitness|exercise|workout|treadmill|weights/i],
    response: () =>
      `💪 Our **Fitness Center / Gym** is open daily from **6:00 AM to 10:00 PM** for all registered hotel guests. It is equipped with cardio machines, treadmill, stationary bike, free weights, and stretching areas. Is there anything else you need?`,
  },

  // 5. Housekeeping, Cleaning & Make Up Room
  {
    patterns: [/make\s*up\s*room|clean\s*my\s*room|housekeep|tidy|cleaner|sweep|mop/i],
    response: (context) => {
      const roomStr = context?.roomNumber ? `for Room ${context.roomNumber}` : 'for your room'
      return (
        `🧹 **Make Up Room Service:** Available daily between **6:00 AM and 4:00 PM** upon guest request only.\n\n` +
        `• Housekeeping & Maintenance desk is on standby **24 hours** for fresh towels, bedsheets, and toiletries.\n\n` +
        `Would you like me to dispatch housekeeping ${roomStr} right now?`
      )
    },
  },

  // 6. Maintenance & Repairs
  {
    patterns: [/maintenance|repair|fix|broken|aircon|ac\s*not|leaking|toilet|faucet|bulb|light\s*not/i],
    response: (context) => {
      const roomStr = context?.roomNumber ? `Room ${context.roomNumber}` : 'your room'
      return (
        `🔧 **24-Hour Maintenance Service:**\n` +
        `Our engineering team is on standby 24/7. I'll notify maintenance immediately for ${roomStr}, or you can dial "0" or call **+639615794855** for urgent assistance.`
      )
    },
  },

  // 7. Dining, Food & Restaurant
  {
    patterns: [/breakfast|lunch|dinner|dining|restaurant|eat|grand\s*table|food.*hour|hour.*food/i],
    response: () =>
      `🍽️ **Dining at Kekehyu Hotel:**\n\n` +
      `• **Restaurant "The Grand Table":**\n` +
      `  - Breakfast: 6:30 AM – 10:30 AM\n` +
      `  - Lunch: 12:00 PM – 2:30 PM\n` +
      `  - Dinner: 6:00 PM – 10:00 PM\n` +
      `• **In-Room Dining (Room Service):** 6:00 AM – 9:30 PM (Browse and order in the Dining tab)\n` +
      `• **Pool Bar:** 10:00 AM – 8:00 PM\n\n` +
      `Can I assist you in browsing our digital menu or placing an order?`,
  },

  // 8. Room Service
  {
    patterns: [/room\s*service|order\s*food|in.?room\s*dining|snack/i],
    response: (ctx) => {
      const isNight = ctx?.hour24 !== undefined && (ctx.hour24 >= 22 || ctx.hour24 < 6)
      if (isNight) {
        return (
          `🛎️ In-room dining is available from **6:00 AM to 9:30 PM**.\n` +
          `It is currently closed for the night, but Front Desk (Dial "0") can provide complimentary coffee, tea, and water bottles 24/7. Would you like assistance?`
        )
      }
      return (
        `🛎️ **Room Service** is open daily from **6:00 AM to 9:30 PM**.\n` +
        `You can explore the in-room dining menu directly from the Dining tab in this app and place orders with room delivery. Would you like help choosing?`
      )
    },
  },

  // 9. WiFi & Internet
  {
    patterns: [/wifi|wi-fi|internet|password|network|connect/i],
    response: () =>
      `📶 **Complimentary High-Speed WiFi:**\n` +
      `• Network: **"KekehyuGuest"**\n` +
      `• Password: Printed on your **Keycard Jacket**, or scan the QR code on the back of your keycard jacket for instant connection.\n\n` +
      `If you have trouble connecting, Front Desk (+639615794855) is available 24/7 to assist!`,
  },

  // 10. Check-out Time & Late Check-out
  {
    patterns: [/check.?out|checkout|check.*out.*time|what time.*check/i],
    response: () =>
      `🕛 **Check-out time is 12:00 PM (noon).**\n\n` +
      `• **Late Check-out:** Available upon request (subject to room availability) for a surcharge of **₱1,000 pesos**.\n\n` +
      `Would you like me to request a late check-out arrangement with Front Desk for you?`,
  },

  // 11. Check-in Time & Early Check-in
  {
    patterns: [/check.?in|checkin|check.*in.*time/i],
    response: () =>
      `🕑 **Check-in time is 2:00 PM.**\n\n` +
      `• **Early Check-in:** Available subject to room availability with a surcharge of **₱1,000 pesos**.\n\n` +
      `Shall I connect you with our reception team to check if an early check-in is ready?`,
  },

  // 12. Front Desk & Contact Number
  {
    patterns: [/front\s*desk|reception|phone\s*number|contact\s*number|call\s*hotel|direct\s*number/i],
    response: () =>
      `📞 **Front Desk Contact Information:**\n` +
      `• **Direct Mobile / Hotline:** **+639615794855**\n` +
      `• **In-Room Phone:** Dial **"0"**\n` +
      `• **Availability:** 24 hours daily\n\n` +
      `You can also tap the "Connect to Staff" button below to message our front desk directly in this chat!`,
  },

  // 13. Complimentary Water, Coffee & Tea
  {
    patterns: [/water|mineral\s*water|coffee|tea|beverage/i],
    response: () =>
      `☕ **Complimentary Amenities:**\n` +
      `All rooms receive complimentary bottled mineral water, coffee, and tea. If you need replenishments, our 24-hour housekeeping team will gladly deliver more to your room. Shall I request a refill for you?`,
  },

  // 14. Towels & Extra Amenities
  {
    patterns: [/towel|extra\s*(pillow|blanket|bed|sheet)|slippers|dental|toothbrush|shampoo|soap/i],
    response: (context) => {
      const roomStr = context?.roomNumber ? `to Room ${context.roomNumber}` : 'to your room'
      return (
        `🛎️ Extra towels, pillows, blankets, slippers, and dental/toiletries kits are available 24/7.\n\n` +
        `Would you like me to submit a request to deliver these ${roomStr}?`
      )
    },
  },

  // 15. Parking
  {
    patterns: [/park|car|parking|valet/i],
    response: () =>
      `🚗 **Parking is complimentary** for all registered hotel guests. The parking entrance is situated on the north side of the property with 24-hour security. Need any other assistance?`,
  },

  // 16. Laundry & Dry Cleaning
  {
    patterns: [/laundry|dry.clean|washing|iron|ironing/i],
    response: () =>
      `👔 **Laundry & Dry-Cleaning:**\n` +
      `• For **same-day service**, please submit items before **9:00 AM** , you can ask the front desk or housekeeping for laundry bag.\n` +
      `• Irons and ironing boards can also be delivered to your room upon request. Would you like me to request an iron or laundry pickup?`,
  },

  // 17. Airport Shuttle & Transport
  {
    patterns: [/shuttle|airport|transport|taxi|transfer|grab/i],
    response: () =>
      `🚐 **Airport Shuttle & Transportation:**\n` +
      `We offer airport transfers upon request (48 hours advance notice preferred). Our Front Desk can also arrange local taxis or Grab assistance at **+639615794855**. Would you like to schedule a ride?`,
  },

  // 18. Greetings & Welcome
  {
    patterns: [/hello|hi|hey|good\s*(morning|afternoon|evening)|kamusta|mabuhay/i],
    response: (context) => {
      const roomGreet = context?.roomNumber ? ` in Room ${context.roomNumber}` : ''
      return (
        `👋 Welcome to Kekehyu Hotel! I'm your AI concierge, here to assist you${roomGreet}.\n\n` +
        `How can I help you today? You can ask me about room service, spa & sauna, gym hours, dining, or request hotel amenities!`
      )
    },
  },
]

function runFallbackRules(message: string, context?: AiGuestContext): string | null {
  for (const rule of FALLBACK_RULES) {
    if (rule.patterns.some((p) => p.test(message))) {
      return rule.response(context)
    }
  }
  return null
}

// ─── Gemini REST API Call ─────────────────────────────────────────────────────

function buildDynamicSystemPrompt(context?: AiGuestContext): string {
  let contextSnippet = ''
  if (context) {
    const timeStr =
      context.localTime ||
      new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'short',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      })

    const h = context.hour24 !== undefined ? context.hour24 : new Date().getUTCHours() + 8
    const hour = (h + 24) % 24

    const roomServiceStatus = hour >= 6 && hour < 22 ? 'OPEN (6:00 AM – 9:30 PM)' : 'CLOSED (reopens 6:00 AM)'
    const makeUpRoomStatus = hour >= 6 && hour < 16 ? 'AVAILABLE upon request (6:00 AM – 4:00 PM)' : 'CLOSED (ended 4:00 PM, 24/7 housekeeping available for towels/amenities)'
    const gymStatus = hour >= 6 && hour < 22 ? 'OPEN (6:00 AM – 10:00 PM)' : 'CLOSED (reopens 6:00 AM)'
    const saunaStatus = hour >= 6 && hour < 22 ? 'OPEN (6:00 AM – 10:00 PM, ₱250)' : 'CLOSED (reopens 6:00 AM)'
    const spaStatus = hour >= 9 && hour < 21 ? 'OPEN (9:00 AM – 9:00 PM)' : 'CLOSED (reopens 9:00 AM)'

    contextSnippet = `\n\n== LIVE STAY CONTEXT ==
- Guest Room: ${context.roomNumber ? `Room ${context.roomNumber}` : 'Hotel Guest'}
- Guest Name: ${context.guestName || 'Guest'}
- Current Hotel Time: ${timeStr} (Philippine Standard Time)
- Current Operational Status:
  * In-Room Dining: ${roomServiceStatus}
  * Make Up Room: ${makeUpRoomStatus}
  * Gym: ${gymStatus}
  * Sauna: ${saunaStatus}
  * Spa: ${spaStatus}
  * Front Desk / Maintenance: OPEN 24/7 (+639615794855)`
  }

  return `${HOTEL_SYSTEM_PROMPT}${contextSnippet}`
}

async function callGemini(
  history: AiChatMessage[],
  currentMessage: string,
  context?: AiGuestContext
): Promise<string | null> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY

  if (!apiKey) return null

  // Models to try in order of priority (configurable via GEMINI_MODEL env var)
  const preferredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
  const fallbackModels = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
  const models = Array.from(new Set([preferredModel, ...fallbackModels]))

  // 1. Build sanitized alternating turn history
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []

  for (const m of history) {
    const text = m.text?.trim()
    if (!text) continue

    // Gemini requires multi-turn conversation to start with 'user'
    if (contents.length === 0 && m.role !== 'user') {
      continue
    }

    const last = contents[contents.length - 1]
    if (last && last.role === m.role) {
      // Merge consecutive same-role turns into multiple parts
      last.parts.push({ text })
    } else {
      contents.push({
        role: m.role,
        parts: [{ text }],
      })
    }
  }

  // 2. Append current user message (or merge if trailing was already user)
  const trimmedCurrent = currentMessage.trim()
  const last = contents[contents.length - 1]
  if (last && last.role === 'user') {
    const hasCurrent = last.parts.some((p) => p.text.trim() === trimmedCurrent)
    if (!hasCurrent) {
      last.parts.push({ text: trimmedCurrent })
    }
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: trimmedCurrent }],
    })
  }

  const systemPrompt = buildDynamicSystemPrompt(context)

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.5,
            topP: 0.95,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ],
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (text?.trim()) {
          return text.trim()
        }
      } else {
        const errJson = await response.json().catch(() => null)
        console.warn(
          `[AI] Gemini ${model} returned ${response.status}:`,
          errJson?.error?.message || response.statusText
        )
      }
    } catch (err) {
      console.warn(`[AI] Gemini ${model} fetch error:`, err)
    }
  }

  return null
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate an AI assistant response for a guest message.
 * @param message     The guest's latest message.
 * @param history     Prior conversation turns (oldest first, max 10 messages).
 * @param context     Live context (room number, current time, guest info).
 * @returns           AI response text + escalation flag + source.
 */
export async function generateAiResponse(
  message: string,
  history: AiChatMessage[] = [],
  context?: AiGuestContext
): Promise<AiAssistantResponse> {
  // 1. Check escalation intent first — if detected, provide front desk info and escalate
  if (detectEscalationIntent(message)) {
    return {
      text:
        "I'll connect you with our Front Desk team member right away. 🧑‍💼\n\n" +
        "You can also reach our Front Desk directly at **+639615794855** or dial **0** from your room phone. Please hold on while I transfer your conversation.",
      shouldEscalate: true,
      source: 'RULE_FALLBACK',
    }
  }

  // 2. Try Gemini API with live context
  const trimmedHistory = history.slice(-10)
  const geminiText = await callGemini(trimmedHistory, message, context)

  if (geminiText) {
    const geminiEscalate = detectEscalationIntent(geminiText)
    return {
      text: geminiText,
      shouldEscalate: geminiEscalate,
      source: 'GEMINI',
    }
  }

  // 3. Fallback rule engine with context
  const fallbackText = runFallbackRules(message, context)
  if (fallbackText) {
    return {
      text: fallbackText,
      shouldEscalate: false,
      source: 'RULE_FALLBACK',
    }
  }

  // 4. Default hospitable fallback
  return {
    text:
      "I'm here to assist with any hotel inquiries, dining, spa bookings, or room amenities! 🏨\n\n" +
      "For specific requests, our Front Desk is available 24/7 at **+639615794855** or you can tap **Connect to Staff** below.",
    shouldEscalate: false,
    source: 'RULE_FALLBACK',
  }
}

// ─── Smart Reply Generator ────────────────────────────────────────────────────

/**
 * Generate 3 short smart reply suggestions for hotel staff.
 * @param conversationHistory  Last 6 messages in the conversation.
 * @returns Array of 3 short reply suggestion strings.
 */
export async function generateSmartReplies(
  conversationHistory: AiChatMessage[]
): Promise<string[]> {
  const DEFAULT_REPLIES = [
    "I'll look into that for you right away!",
    'Thank you for letting us know. We\'ll arrange that immediately.',
    'Please give us a few minutes. A staff member will assist you shortly.',
  ]

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY

  if (!apiKey) return DEFAULT_REPLIES

  const historyText = conversationHistory
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Guest' : 'Staff/AI'}: ${m.text}`)
    .join('\n')

  const prompt = `You are a hotel staff assistant. Based on this conversation, generate exactly 3 short, professional reply suggestions for the hotel staff member to send. Each reply must be under 15 words, friendly, and actionable.

Conversation:
${historyText}

Return ONLY a JSON array of 3 strings, no explanation. Example: ["Reply 1", "Reply 2", "Reply 3"]`

  const preferredModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
  const fallbackModels = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
  const models = Array.from(new Set([preferredModel, ...fallbackModels]))
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 150, temperature: 0.3 },
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

        const startIdx = rawText.indexOf('[')
        const endIdx = rawText.lastIndexOf(']')
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          const jsonMatch = rawText.slice(startIdx, endIdx + 1)
          const parsed = JSON.parse(jsonMatch)
          if (Array.isArray(parsed) && parsed.length >= 3) {
            return parsed.slice(0, 3).map((s: unknown) => String(s))
          }
        }
      }
    } catch {
      // try next model
    }
  }

  return DEFAULT_REPLIES
}

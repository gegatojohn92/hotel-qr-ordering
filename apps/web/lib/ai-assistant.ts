/**
 * AI Assistant Engine
 * Uses Gemini Flash via REST API to power the hotel AI concierge.
 * Falls back to a built-in rule engine if the API key is absent or the request fails.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiChatMessage {
  role: 'user' | 'model'
  text: string
}

export interface AiAssistantResponse {
  text: string
  shouldEscalate: boolean
  source: 'GEMINI' | 'RULE_FALLBACK'
}

// ─── Hotel Knowledge Base ─────────────────────────────────────────────────────

const HOTEL_SYSTEM_PROMPT = `You are Kekehyu AI, the friendly and professional AI concierge for Kekehyu Hotel. Your role is to assist hotel guests with accurate, helpful information.

== Hotel Policies & Information ==
- Check-in time: 2:00 PM | Check-out time: 12:00 PM (noon)
- Late check-out available upon request (subject to availability, surcharge may apply, 1000 pesos)
- Early check-in available upon request (subject to availability, surcharge may apply, 1000 pesos)
- WiFi Network: "KekehyuGuest" | Password: Available at Keycard Jacket, or scan the qr at the back of the keycard jacket
- Room service available: 6:00 AM – 9:30 PM
- Housekeeping: Daily service between 6:00 AM – 4:00 PM

== Dining ==
- Restaurant "The Grand Table": Breakfast 6:30–10:30 AM, Lunch 12:00–2:30 PM, Dinner 6:00–10:00 PM
- In-room dining available via the digital menu in this app
- Pool Bar: 10:00 AM – 8:00 PM

== Spa & Wellness ==
- Kekehyu Spa: Daily 9:00 AM – 9:00 PM
- Bookings recommended; walk-ins subject to availability
- Services include massage, facial, body scrub, and wellness packages

== Amenities ==
-
- gym : 6am to 10pm 
- Front desk: 24 hours
- Maintenance: 24 hours at Front Desk
- Laundry & dry-cleaning: Same-day service if submitted before 9:00 AM
- Airport shuttle: Available upon request (48 hours advance notice preferred)
- Parking: Complimentary for registered guests
- Complimentary mineral water for all guests
- Complimentary tea and coffee for all guests
- Housekeeping 24hrs 
- make up room 6am to 4pm upon guest request only

== Billing ==
- Room charges settled at check-out unless pre-payment arranged
- Accepted payments: Cash, Credit/Debit Cards, Bank Transfer
- Service charge: 10% applies to dining and spa services

== Emergency ==
- Front Desk: Dial "0" from your room phone or use the chat button below to speak with a staff member
- In case of emergency: Dial "911" or the Front Desk immediately

== Behavior Guidelines ==
- Always be warm, concise, and professional.
- NEVER fabricate prices, policies, or availability. If unsure, say "I'll connect you with our Front Desk for accurate details."
- NEVER authorize discounts, room upgrades, or refunds. Direct guests to human staff for those.
- If a guest expresses frustration, urgency, or requests human assistance, set escalate=true immediately.
- Keep responses short (2-4 sentences max) unless the guest asks for detail.
- Always end responses with a helpful follow-up question or offer.

Respond in the same language the guest uses.`

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
]

export function detectEscalationIntent(message: string): boolean {
  return ESCALATION_PATTERNS.some((pattern) => pattern.test(message))
}

// ─── Fallback Rule Engine ─────────────────────────────────────────────────────

interface FallbackRule {
  patterns: RegExp[]
  response: string
}

const FALLBACK_RULES: FallbackRule[] = [
  {
    patterns: [/breakfast|lunch|dinner|dining|restaurant|eat|food.*hour|hour.*food/i],
    response:
      '🍽️ Our restaurant **"The Grand Table"** serves Breakfast 6:30–10:30 AM, Lunch 12:00–2:30 PM, and Dinner 6:00–10:00 PM. You can also order in-room dining through this app anytime between 6 AM and 11 PM. Can I help you place an order?',
  },
  {
    patterns: [/wifi|wi-fi|internet|password|network/i],
    response:
      '📶 Connect to **"KekehyuGuest"** WiFi. The password is available at the Front Desk — just ask or tap "Connect to Staff" below and we\'ll send it to you right away. Is there anything else I can help with?',
  },
  {
    patterns: [/check.?out|checkout|check.*out.*time|what time.*check/i],
    response:
      '🕛 Check-out time is **12:00 PM (noon)**. If you need a late check-out, we can arrange that subject to availability — just let me know! Is there anything else I can assist with?',
  },
  {
    patterns: [/check.?in|checkin|check.*in.*time/i],
    response:
      '🕑 Check-in time is **2:00 PM**. Early check-in is available based on room availability. Would you like me to connect you with Front Desk to arrange an early check-in?',
  },
  {
    patterns: [/pool|swim|swimming/i],
    response:
      '🏊 Our outdoor swimming pool is open daily from **7:00 AM to 10:00 PM**. Towels are available at the poolside. Is there anything else you need?',
  },
  {
    patterns: [/spa|massage|facial|wellness|treatment/i],
    response:
      '💆 The Kekehyu Spa is open daily **9:00 AM – 9:00 PM**. We offer massages, facials, body scrubs, and wellness packages. You can book through the Spa tab in this app. Shall I help you book an appointment?',
  },
  {
    patterns: [/gym|fitness|exercise|workout/i],
    response:
      '💪 Our Fitness Center is open **24 hours** with key card access. It\'s fully equipped with cardio machines and free weights. Is there anything else I can help with?',
  },
  {
    patterns: [/park|car|parking/i],
    response:
      '🚗 Parking is **complimentary** for all registered guests. The entrance is on the north side of the hotel. Need any other assistance?',
  },
  {
    patterns: [/laundry|dry.clean|washing/i],
    response:
      '👔 Laundry and dry-cleaning are available. For **same-day service**, please submit before **9:00 AM**. Items can be left in the laundry bag in your wardrobe. Would you like housekeeping to collect it?',
  },
  {
    patterns: [/shuttle|airport|transport|taxi|transfer/i],
    response:
      '🚐 We offer airport shuttle service — **48 hours advance notice** is preferred. Please let me connect you with our concierge to arrange the details. Shall I transfer you to a staff member?',
  },
  {
    patterns: [/room.?service|housekeep|clean|tidy|towel/i],
    response:
      '🛎️ Room service is available **6:00 AM – 11:00 PM**. Housekeeping runs daily **9:00 AM – 4:00 PM**. If you need immediate assistance, I can connect you to our Front Desk. What do you need?',
  },
  {
    patterns: [/hello|hi|hey|good\s*(morning|afternoon|evening)|greet/i],
    response:
      '👋 Welcome to Kekehyu Hotel! I\'m your AI concierge, here to assist with anything you need — dining, spa, room service, or hotel info. How can I make your stay wonderful today?',
  },
]

function runFallbackRules(message: string): string | null {
  for (const rule of FALLBACK_RULES) {
    if (rule.patterns.some((p) => p.test(message))) {
      return rule.response
    }
  }
  return null
}

// ─── Gemini REST API Call ─────────────────────────────────────────────────────

async function callGemini(
  history: AiChatMessage[],
  currentMessage: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`

  // Build conversation history for Gemini multi-turn
  const contents = [
    ...history.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: currentMessage }],
    },
  ]

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: HOTEL_SYSTEM_PROMPT }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.4,
          topP: 0.9,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      }),
    })

    if (!response.ok) {
      console.warn('[AI] Gemini API error:', response.status, await response.text())
      return null
    }

    const data = await response.json()
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.[0]?.text
    return text?.trim() || null
  } catch (err) {
    console.error('[AI] Gemini fetch exception:', err)
    return null
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate an AI assistant response for a guest message.
 * @param message     The guest's latest message.
 * @param history     Prior conversation turns (oldest first, max 10 messages).
 * @returns           AI response text + escalation flag + source.
 */
export async function generateAiResponse(
  message: string,
  history: AiChatMessage[] = []
): Promise<AiAssistantResponse> {
  // 1. Check escalation intent first — if detected, skip AI and escalate
  if (detectEscalationIntent(message)) {
    return {
      text: "I'll connect you with a Front Desk team member right away. Please hold on while I transfer your conversation. 🧑‍💼",
      shouldEscalate: true,
      source: 'RULE_FALLBACK',
    }
  }

  // 2. Try Gemini API
  const trimmedHistory = history.slice(-10) // Keep last 10 turns max
  const geminiText = await callGemini(trimmedHistory, message)

  if (geminiText) {
    // Check if Gemini itself suggests escalation
    const geminiEscalate = detectEscalationIntent(geminiText)
    return {
      text: geminiText,
      shouldEscalate: geminiEscalate,
      source: 'GEMINI',
    }
  }

  // 3. Fallback rule engine
  const fallbackText = runFallbackRules(message)
  if (fallbackText) {
    return {
      text: fallbackText,
      shouldEscalate: false,
      source: 'RULE_FALLBACK',
    }
  }

  // 4. Default fallback
  return {
    text: "I'm sorry, I don't have specific information on that. Let me connect you with our Front Desk for accurate assistance! 🏨",
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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return DEFAULT_REPLIES

  const historyText = conversationHistory
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Guest' : 'Staff/AI'}: ${m.text}`)
    .join('\n')

  const prompt = `You are a hotel staff assistant. Based on this conversation, generate exactly 3 short, professional reply suggestions for the hotel staff member to send. Each reply must be under 15 words, friendly, and actionable.

Conversation:
${historyText}

Return ONLY a JSON array of 3 strings, no explanation. Example: ["Reply 1", "Reply 2", "Reply 3"]`

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.3 },
      }),
    })

    if (!response.ok) return DEFAULT_REPLIES

    const data = await response.json()
    const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Extract JSON array from the response (avoid /s flag for ES target compat)
    const startIdx = rawText.indexOf('[')
    const endIdx = rawText.lastIndexOf(']')
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return DEFAULT_REPLIES
    const jsonMatch = rawText.slice(startIdx, endIdx + 1)

    const parsed = JSON.parse(jsonMatch)
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed.slice(0, 3).map((s: unknown) => String(s))
    }
    return DEFAULT_REPLIES
  } catch {
    return DEFAULT_REPLIES
  }
}

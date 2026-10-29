// ============================================
// CONFIGURACIÓN DEL NEGOCIO — EDITAR SOLO ESTO
// ============================================
const NEGOCIO = {
  nombre: "Blanc Clínica Dental",
  tipo: "clínica dental",
  ciudad: "Valencia",
  direccion: "Calle de Colón 15, 46004 Valencia",
  telefono: "654 256 764",
  whatsapp: "34654256764",
  // --- ajustes técnicos del agente (los usa el motor de abajo) ---
  dominios: ["https://dental.creskio.com", "https://pabloagencia.github.io"],  // webs que pueden usar este chat; vacío = cualquiera (rellenar con el dominio de la web)
  idioma: "es",
  camposReserva: [],  // datos extra obligatorios al reservar
  horario: "Lunes a viernes mañana de 9:30 a 14:00 y tarde de 16:30 a 20:00. Sábados y domingos cerrado.",
  web: "https://blancclinica.es",
  servicios: `- Implantes Dentales: desde 900€ por implante
- Ortodoncia Invisible: desde 1.500€
- Blanqueamiento Dental: desde 250€
- Carillas de Porcelana: desde 400€ por unidad
- Limpieza Profesional: desde 60€
- Endodoncia: desde 150€
- Empastes Estéticos: desde 40€
- Periodoncia: desde 80€/sesión
- Financiación disponible sin intereses hasta 12 meses`,
  instrucciones_extra: `- La primera consulta de valoración dental es GRATUITA y SIN COMPROMISO, promuévela siempre
- Cuando pregunten por precios, da los rangos orientativos disponibles e invita a la consulta gratuita para presupuesto cerrado y personalizado
- Para urgencias dentales \(dolor intenso\), deriva inmediatamente al teléfono, deriva al teléfono directo`
}
// ============================================
// FIN CONFIGURACIÓN — NO EDITAR LO DE ABAJO
// ============================================

const SYSTEM_PROMPT = `Eres el asistente virtual de ${NEGOCIO.nombre}, ${NEGOCIO.tipo} en ${NEGOCIO.ciudad}. Respondes siempre en español, de forma amable y concisa.

IDENTIDAD: Habla SIEMPRE en primera persona del plural: "nuestra clínica", "te atendemos", "hacemos", "somos". NUNCA uses tercera persona como "la clínica", "ellos", "escríbeles".

DATOS DEL NEGOCIO:
- Dirección: ${NEGOCIO.direccion}
- Teléfono: ${NEGOCIO.telefono}
- Horario: ${NEGOCIO.horario}
- Web: ${NEGOCIO.web}

SERVICIOS Y PRECIOS ORIENTATIVOS:
${NEGOCIO.servicios}

CITAS — FLUJO OBLIGATORIO:
Cuando alguien quiera pedir cita o reservar, SIEMPRE ofrece las DOS opciones en el mismo mensaje antes de buscar huecos:
  "¿Cómo prefieres hacerlo? Puedo buscarte un hueco disponible y reservarlo ahora mismo aquí, o si prefieres hablar con el equipo antes de decidirte, escríbenos por WhatsApp: https://wa.me/${NEGOCIO.whatsapp} 💬"
Si el usuario elige reservar aquí: consulta huecos disponibles, muestra 3-4 opciones concretas de fecha y hora, pide nombre y email, crea la cita.
Confirma siempre con día, hora y que recibirán email de confirmación. Tras confirmar la cita, añade: "Si tienes cualquier duda antes de tu cita, escríbenos por WhatsApp: https://wa.me/${NEGOCIO.whatsapp}"
NUNCA menciones "Cal.com", "plataforma" ni ningún software externo. Di siempre "nuestra agenda online" o "aquí mismo".

INSTRUCCIONES:
- Si no sabes el precio exacto, da los rangos disponibles e invita a la consulta gratuita
- Nunca inventes información que no tienes
- Si hay urgencia médica, da el teléfono directo y el WhatsApp
${NEGOCIO.instrucciones_extra}

FORMATO ESTRICTO:
- NUNCA uses markdown: sin asteriscos (*), sin ## títulos, sin guiones (-) para listas
- Para palabras o datos importantes usa MAYÚSCULAS (ej: GRATIS, SIN COMPROMISO, 180€)
- Puedes usar emojis cuando sea natural: ✨💉🌿📅✅
- Máximo 3 frases por respuesta salvo que la situación requiera más`

// ============================================
// MOTOR DEL AGENTE — IGUAL PARA TODAS LAS WEBS (versión 29-oct-2026)
// Lo único que cambia entre negocios está arriba: NEGOCIO y SYSTEM_PROMPT.
// Novedades: Haiku 5.5 sin pensamiento, captura de contactos por email,
// reservas con día/hora calculados por el servidor, CORS y mensajes validados.
// ============================================

const DEFAULT_MODEL = 'claude-haiku-5-5'
const EN = (NEGOCIO.idioma || 'es') === 'en'
const ZONA = NEGOCIO.zona || (EN ? 'America/Denver' : 'Europe/Madrid')
const LOCALE = EN ? 'en-US' : 'es-ES'
const LIMITE_HORA = NEGOCIO.limiteHora || 10
const MAX_TOKENS = NEGOCIO.maxTokens || 600
const CAMPOS = NEGOCIO.camposReserva || []
const WA = NEGOCIO.whatsapp
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MS_DAY = 24 * 60 * 60 * 1000

const TXT = EN ? {
  limite: `You've reached the message limit for now. To continue, contact us directly: https://wa.me/${WA}`,
  tecnico: `Sorry, there was a technical issue. Contact us directly: https://wa.me/${WA}`,
  reserva: `I'm having trouble completing that. Please contact us directly: https://wa.me/${WA}`,
  slotsDesc: "Look up free appointment slots. Use it when the customer wants to book. Returns, per day, a 'label' (e.g. 'Monday November 2') and slots with 'time' (local time) and 'iso'.",
  bookDesc: "Create the appointment once the customer has confirmed the time and given their details.",
  leadDesc: "Save the contact details of someone who wants the team to get in touch with them without booking an appointment.",
  slotIso: "The 'iso' value of the chosen slot, copied exactly from get_available_slots.",
  name: "Customer's name", email: "Customer's email", contact: "Email or phone number",
  note: "What they need, ONLY if they said it themselves. Do not invent or assume needs.",
  resumen: "How the conversation went in 1-2 sentences, third person, separating (1) test questions and (2) what the visitor really said about their situation. Facts only, no sensitive data.",
  startDate: "Start date YYYY-MM-DD", endDate: "End date YYYY-MM-DD (max 7 days later)",
  extra: `
SCHEDULE RULES (technical):
- When showing slots use EXACTLY the "label" (day) and "time" returned by get_available_slots; never work out the weekday or the time zone yourself. To book, pass in slot_iso the "iso" of the chosen slot exactly as returned.
- If asked whether you are a person or a robot, say clearly that you are an AI assistant, and offer the WhatsApp link if they prefer to talk to a person.
LEAVING CONTACT DETAILS WITHOUT BOOKING:
- If the person prefers that the team contacts them (they give a name and a phone or email without booking), call save_lead with name, contact, note (what they need, only what they said) and resumen (how the conversation went, 1-2 sentences). You may only say you have passed their details on AFTER receiving success:true from save_lead; if it errors, offer the WhatsApp link. The first time you ask for their details, say in one short sentence that only the team will use them to get back to them about their enquiry. Never ask for or store health or other sensitive data; if the visitor mentions it, do not repeat it.`
} : {
  limite: `Has alcanzado el límite de mensajes por ahora. Para seguir hablando, escríbenos por WhatsApp: https://wa.me/${WA}`,
  tecnico: `Estoy teniendo un problema técnico ahora mismo. Escríbenos por WhatsApp y te atendemos: https://wa.me/${WA} 💬`,
  reserva: `Estoy teniendo problemas para completar la gestión. Escríbenos directamente por WhatsApp: https://wa.me/${WA} 💬`,
  slotsDesc: "Consulta huecos libres para cita. Úsala cuando el cliente quiera pedir cita. Devuelve, por día, un 'label' (ej. 'lunes 2 de noviembre') y huecos con 'time' (hora de Madrid) e 'iso'.",
  bookDesc: "Crea la cita cuando el cliente confirmó la hora y dio sus datos.",
  leadDesc: "Guarda los datos de contacto de alguien que quiere que el equipo le contacte sin reservar cita.",
  slotIso: "Valor 'iso' del hueco elegido, copiado tal cual de get_available_slots.",
  name: "Nombre del cliente", email: "Email del cliente", contact: "Email o teléfono",
  note: "Qué necesita, SOLO si lo ha dicho él. No inventes ni deduzcas necesidades.",
  resumen: "Cómo ha ido la conversación en 1-2 frases, en tercera persona, separando (1) preguntas de prueba y (2) lo que el visitante dijo de verdad sobre su situación. Solo hechos, sin datos sensibles.",
  startDate: "Fecha inicio en YYYY-MM-DD", endDate: "Fecha fin en YYYY-MM-DD (máximo 7 días después)",
  extra: `
REGLAS DE LA AGENDA (técnicas):
- Al mostrar huecos usa EXACTAMENTE el "label" (día) y la "time" (hora) que devuelve get_available_slots; nunca calcules tú el día de la semana ni la zona horaria. Para reservar, pasa en slot_iso el "iso" del hueco elegido tal cual.
- Si preguntan si eres una persona o un robot, di con claridad que eres un asistente de IA y ofrece el WhatsApp si prefieren hablar con una persona.
DEJAR DATOS SIN RESERVAR:
- Si la persona prefiere que el equipo le contacte (te da nombre y un teléfono o email sin reservar cita), llama a save_lead con name, contact, note (qué necesita, solo lo que haya dicho) y resumen (cómo ha ido la conversación, 1-2 frases). Solo puedes decir que has pasado sus datos DESPUÉS de recibir success:true de save_lead; si da error, ofrece el WhatsApp. La primera vez que se los pidas, di en una frase corta que solo los usará el equipo para contactarle sobre su consulta. No pidas ni guardes datos de salud ni otros datos sensibles; si el visitante los menciona, no los repitas.`
}

function buildTools() {
  const extraProps = {}
  const extraReq = []
  for (const c of CAMPOS) {
    extraProps[c.name] = { type: "string", description: c.desc }
    if (c.required) extraReq.push(c.name)
  }
  return [
    {
      name: "get_available_slots",
      description: TXT.slotsDesc,
      input_schema: {
        type: "object",
        properties: {
          start_date: { type: "string", description: TXT.startDate },
          end_date: { type: "string", description: TXT.endDate }
        },
        required: ["start_date", "end_date"]
      }
    },
    {
      name: "create_booking",
      description: TXT.bookDesc,
      input_schema: {
        type: "object",
        properties: {
          slot_iso: { type: "string", description: TXT.slotIso },
          attendee_name: { type: "string", description: TXT.name },
          attendee_email: { type: "string", description: TXT.email },
          ...extraProps
        },
        required: ["slot_iso", "attendee_name", "attendee_email", ...extraReq]
      }
    },
    {
      name: "save_lead",
      description: TXT.leadDesc,
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: TXT.name },
          contact: { type: "string", description: TXT.contact },
          note: { type: "string", description: TXT.note },
          resumen: { type: "string", description: TXT.resumen }
        },
        required: ["name", "contact"]
      }
    }
  ]
}
const tools = buildTools()

function labelDia(date) {
  return date.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: ZONA }).replace(',', '')
}
function labelHora(date) {
  return date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: ZONA })
}

async function getAvailableSlots(input, calApiKey, eventTypeId) {
  const hoy = new Date()
  let start = new Date(`${input.start_date}T00:00:00Z`)
  let end = new Date(`${input.end_date}T00:00:00Z`)
  if (isNaN(start) || isNaN(end)) return { error: 'Invalid dates, use YYYY-MM-DD' }
  if (start < new Date(hoy.getTime() - MS_DAY)) start = hoy
  if (end <= start) end = new Date(start.getTime() + 7 * MS_DAY)
  if (end - start > 14 * MS_DAY) end = new Date(start.getTime() + 14 * MS_DAY)
  const ymd = d => d.toISOString().slice(0, 10)
  const url = `https://api.cal.com/v2/slots?eventTypeId=${eventTypeId}&start=${ymd(start)}&end=${ymd(end)}&timeZone=${ZONA}`
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${calApiKey}`, 'cal-api-version': '2024-09-04' }
  })
  const data = await res.json()
  if (!res.ok) return { error: 'Could not get slots' }
  const formatted = {}
  for (const [date, slots] of Object.entries(data.data || {})) {
    if (!slots.length) continue
    const huecos = slots.slice(0, 8).map(slot => {
      const d = new Date(slot.start)
      return { time: labelHora(d), iso: d.toISOString() }
    })
    formatted[date] = { label: labelDia(new Date(slots[0].start)), slots: huecos }
  }
  if (!Object.keys(formatted).length) return { available_slots: {}, aviso: 'No slots in those dates: try another week or offer the WhatsApp link' }
  return { available_slots: formatted }
}

async function createBooking(input, calApiKey, eventTypeId) {
  const name = String(input.attendee_name || '').trim()
  const email = String(input.attendee_email || '').trim()
  if (name.length < 2 || name.length > 80) return { error: 'Invalid name, ask again' }
  if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'Invalid email, ask the customer to repeat it' }
  const inicio = new Date(input.slot_iso)
  if (isNaN(inicio)) return { error: 'Invalid slot: use the exact iso returned by get_available_slots' }
  if (inicio.getTime() < Date.now() + 30 * 60 * 1000) return { error: 'That slot is no longer available, look up slots again' }
  if (inicio.getTime() > Date.now() + 60 * MS_DAY) return { error: 'That slot is too far ahead, offer a closer one' }
  const metadata = {}
  for (const c of CAMPOS) {
    const valor = String(input[c.name] || '').trim().slice(0, 200)
    if (c.required && !valor) return { error: `Missing ${c.name}, ask for it before booking` }
    metadata[c.meta || c.name] = valor
  }
  const res = await fetch('https://api.cal.com/v2/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${calApiKey}`,
      'cal-api-version': '2024-08-13'
    },
    body: JSON.stringify({
      eventTypeId: parseInt(eventTypeId),
      start: inicio.toISOString(),
      attendee: { name, email, timeZone: ZONA, language: EN ? 'en' : 'es' },
      metadata
    })
  })
  const data = await res.json()
  if (!res.ok) return { error: 'Could not create the booking (the slot may be taken): offer another slot or the WhatsApp link' }
  return {
    success: true,
    booking_id: data.data.uid,
    cuando: EN ? `${labelDia(inicio)} at ${labelHora(inicio)}` : `${labelDia(inicio)} a las ${labelHora(inicio)} (hora de Madrid)`,
    title: data.data.title
  }
}

// Guarda el contacto: se envía por email al negocio (Resend). Si falla, copia temporal de 30 días en KV.
async function saveLead(input, env) {
  const name = String(input.name || '').trim().slice(0, 80)
  const contact = String(input.contact || '').trim().slice(0, 120)
  const note = String(input.note || '').trim().slice(0, 300)
  const resumen = String(input.resumen || '').trim().slice(0, 500)
  const digits = contact.replace(/\D/g, '')
  const esEmail = EMAIL_RE.test(contact)
  const esTel = !esEmail && digits.length >= 7 && digits.length <= 15
  if (name.length < 2) return { error: 'Missing name' }
  if (!esEmail && !esTel) return { error: 'The contact is neither an email nor a phone number, ask again' }
  const lead = { name, contact, note, resumen, fecha: new Date().toISOString(), origen: `chat-${NEGOCIO.nombre}` }

  if (env.RESEND_API_KEY && env.LEAD_NOTIFY_TO && env.LEAD_FROM) {
    try {
      const primerNombre = name.split(/\s+/)[0]
      const cuando = new Date().toLocaleString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: ZONA })
      let comoContactar = contact
      if (esTel) {
        const num = digits.length === 9 && !EN ? `34${digits}` : digits.replace(/^00/, '')
        comoContactar = `${contact}  →  ${EN ? 'WhatsApp' : 'escríbele por WhatsApp'}: https://wa.me/${num}`
      }
      const lineas = EN
        ? ['Hi,', '', `${name} left their contact details in the ${NEGOCIO.nombre} chat and prefers that you get in touch instead of booking an appointment.`, '']
        : ['Hola,', '', `${name} ha dejado su contacto en el chat de ${NEGOCIO.nombre} y prefiere que le contactéis vosotros en vez de reservar cita.`, '']
      if (note) lineas.push(`${EN ? 'What they need' : 'Lo que necesita'}: ${note}`)
      if (resumen) lineas.push(`${EN ? 'How the conversation went' : 'Cómo fue la conversación'}: ${resumen}`)
      lineas.push('', `${EN ? 'How to reach them' : 'Cómo contactarle'}: ${comoContactar}`, '', `${EN ? 'Left on' : 'Lo dejó'} ${cuando}.`, '', `— ${EN ? 'The AI assistant of' : 'El asistente IA de'} ${NEGOCIO.nombre}`)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.LEAD_FROM,
          to: [env.LEAD_NOTIFY_TO],
          ...(esEmail ? { reply_to: contact } : {}),
          subject: EN ? `${primerNombre} wants to be contacted (${NEGOCIO.nombre})` : `${primerNombre} quiere que le contactéis (${NEGOCIO.nombre})`,
          text: lineas.join('\n')
        })
      })
      if (res.ok) return { success: true }
    } catch (e) { /* cae a la copia temporal */ }
  }
  if (env.RATE_LIMIT_KV) {
    try {
      await env.RATE_LIMIT_KV.put(`lead:${lead.fecha}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(lead), { expirationTtl: 30 * 24 * 3600 })
      return { success: true }
    } catch (e) { /* sin ninguna vía */ }
  }
  return { error: 'Could not save the contact: offer the WhatsApp link' }
}

async function checkRateLimit(kv, ip, sessionId) {
  if (!kv) return true
  const now = new Date()
  const hour = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`
  const day = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`
  const [ipCount, sessionCount, globalCount] = await Promise.all([
    kv.get(`ip:${ip}:${hour}`).then(v => parseInt(v || '0')),
    kv.get(`session:${sessionId}:${hour}`).then(v => parseInt(v || '0')),
    kv.get(`global:${day}`).then(v => parseInt(v || '0'))
  ])
  if (ipCount >= LIMITE_HORA || sessionCount >= LIMITE_HORA || globalCount >= 300) return false
  await Promise.all([
    kv.put(`ip:${ip}:${hour}`, String(ipCount + 1), { expirationTtl: 3600 }),
    kv.put(`session:${sessionId}:${hour}`, String(sessionCount + 1), { expirationTtl: 3600 }),
    kv.put(`global:${day}`, String(globalCount + 1), { expirationTtl: 86400 })
  ])
  return true
}

// Solo mensajes de texto de usuario/asistente: nadie puede colar bloques de herramientas ni mensajes enormes.
function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const limpios = []
  for (const m of raw.slice(-14)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null
    const content = m.content.trim().slice(0, 1200)
    if (!content) return null
    limpios.push({ role: m.role, content })
  }
  while (limpios.length && limpios[0].role !== 'user') limpios.shift()
  if (!limpios.length || limpios[limpios.length - 1].role !== 'user') return null
  return limpios
}

// Orígenes permitidos: NEGOCIO.dominios (o la variable ALLOWED_ORIGINS del Worker). Si no hay ninguno, se permite cualquiera.
function origenesPermitidos(env) {
  if (env && env.ALLOWED_ORIGINS) return env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  return NEGOCIO.dominios || []
}
function corsHeaders(request, env) {
  const permitidos = origenesPermitidos(env)
  const base = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }
  if (!permitidos.length) return { ...base, 'Access-Control-Allow-Origin': '*' }
  const origin = request && request.headers.get('Origin')
  return { ...base, 'Access-Control-Allow-Origin': origin && permitidos.includes(origin) ? origin : permitidos[0] }
}
function origenPermitido(request, env) {
  const permitidos = origenesPermitidos(env)
  const origin = request.headers.get('Origin')
  if (!permitidos.length || !origin) return true
  return permitidos.includes(origin)
}

// Contador diario de uso (tokens y llamadas) para vigilar el coste real. No es crítico: si falla, se ignora.
async function recordUsage(kv, usage) {
  if (!kv) return
  try {
    const day = new Date().toISOString().slice(0, 10)
    const key = `usage:${day}`
    const prev = JSON.parse((await kv.get(key)) || '{}')
    const sum = (a, b) => (a || 0) + (b || 0)
    await kv.put(key, JSON.stringify({
      input: sum(prev.input, usage.input), output: sum(prev.output, usage.output),
      cacheWrite: sum(prev.cacheWrite, usage.cacheWrite), cacheRead: sum(prev.cacheRead, usage.cacheRead),
      calls: sum(prev.calls, usage.calls), messages: sum(prev.messages, 1)
    }), { expirationTtl: 90 * 24 * 3600 })
  } catch (e) { /* sin contador */ }
}

export async function onRequestPost(context) {
  const { request, env } = context
  const cors = corsHeaders(request, env)
  const json = (body, status = 200) => Response.json(body, { status, headers: cors })
  try {
    if (!origenPermitido(request, env)) return json({ error: 'origin not allowed' }, 403)
    const body = await request.json()
    const currentMessages = sanitizeMessages(body.messages)
    if (!currentMessages) return json({ error: 'messages invalid' }, 400)
    const sessionId = String(body.sessionId || 'anon').slice(0, 80)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    const allowed = await checkRateLimit(env.RATE_LIMIT_KV, ip, sessionId)
    if (!allowed) return json({ reply: TXT.limite })

    const today = new Date().toLocaleDateString(LOCALE, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: ZONA })
    const fecha = EN ? `\n\nCURRENT DATE: Today is ${today}. Use it to work out relative dates.` : `\n\nFECHA ACTUAL: Hoy es ${today}. Úsala para calcular fechas relativas.`
    const systemFull = SYSTEM_PROMPT + '\n' + TXT.extra + fecha
    const model = env.MODEL || DEFAULT_MODEL
    const extra = model.startsWith('claude-haiku-5') ? { thinking: { type: 'disabled' } } : {}
    const MAX_TOOL_ROUNDS = 5
    const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, calls: 0 }

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: systemFull, cache_control: { type: "ephemeral" } }],
          messages: currentMessages,
          tools,
          ...extra
        })
      })
      const data = await response.json()
      if (!response.ok) return json({ reply: TXT.tecnico })
      const u = data.usage || {}
      usage.input += u.input_tokens || 0
      usage.output += u.output_tokens || 0
      usage.cacheWrite += u.cache_creation_input_tokens || 0
      usage.cacheRead += u.cache_read_input_tokens || 0
      usage.calls++
      if (data.stop_reason !== 'tool_use') {
        await recordUsage(env.RATE_LIMIT_KV, usage)
        const textBlock = data.content.find(b => b.type === 'text' && b.text && b.text.trim())
        return json({ reply: textBlock ? textBlock.text : TXT.tecnico })
      }
      if (round === MAX_TOOL_ROUNDS) {
        await recordUsage(env.RATE_LIMIT_KV, usage)
        return json({ reply: TXT.reserva })
      }
      const toolUse = data.content.find(b => b.type === 'tool_use')
      let toolResult
      try {
        if (toolUse.name === 'get_available_slots') {
          toolResult = await getAvailableSlots(toolUse.input || {}, env.CAL_API_KEY, env.CAL_EVENT_TYPE_ID)
        } else if (toolUse.name === 'create_booking') {
          toolResult = await createBooking(toolUse.input || {}, env.CAL_API_KEY, env.CAL_EVENT_TYPE_ID)
        } else if (toolUse.name === 'save_lead') {
          toolResult = await saveLead(toolUse.input || {}, env)
        } else {
          toolResult = { error: 'Tool not found' }
        }
      } catch (e) {
        toolResult = { error: 'Internal tool failure: offer the WhatsApp link' }
      }
      currentMessages.push({ role: 'assistant', content: data.content })
      currentMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolResult) }]
      })
    }
  } catch (error) {
    return json({ reply: TXT.tecnico })
  }
}

export async function onRequestOptions(context) {
  const request = context && context.request
  const env = context && context.env
  if (request && !origenPermitido(request, env)) return new Response(null, { status: 403 })
  return new Response(null, { headers: corsHeaders(request, env) })
}

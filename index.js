const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('baileys');
const { Boom } = require('@hapi/boom');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

// Hardcoded config (temporary - move to env later)
const SUPABASE_URL = 'https://daekymdalygrcmzcjuev.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TpiomOGFGRc_oDAQIQ3-1A_x4T6HOxD';
const GROQ_API_KEY = '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';
const PHONE_NUMBER = '2349138153604';

// Setup Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Setup Groq AI
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Your phone number
const OWNER_NUMBER = PHONE_NUMBER + '@s.whatsapp.net';

// Track messages to avoid duplicates and loops
const processedMessages = {};
const COOLDOWN_MS = 15000;

// AI Personality - ULTIMATE VERSION
const AI_PERSONALITY = `You are the AI twin of a Nigerian founder & developer based in Abuja. Your name is flexible—use whatever the contact calls him: David, Emmanuel, Kennedy, Wax, Wazi, Wazobia, or just "me" if no specific name is known. You sound EXACTLY like him.

## CORE IDENTITY
- Vision-driven, independent thinker, builder, direct, slightly impatient with fluff.
- Not emotionally expressive unless the situation genuinely calls for it. Internally intense, externally calm.
- Communication style: direct, slightly guarded, goal-focused, no unnecessary talk.
- Prefers useful conversation over emotional chatter.

## COMMUNICATION RULES

### Tone & Style
- Keep responses short and punchy. No essays unless the user explicitly asks for depth or explanation.
- Sound natural—use Nigerian English, with occasional UK slang when it fits. Mix pidgin lightly ("na", "abeg", "wahala", "omo", "no be so") but don't overdo it; keep it mature.
- Never sound robotic, formal, or "assistant-like". You're a thinking partner, not a helpdesk.
- No fake hype. No "Amazing!!!" or "You got this!!!" energy. Calm, real, respectful.
- If you don't know something, say "I no sure about that one, but we fit check am" or "I no get that info right now".

### Conversation Management
- Match the contact's vibe: professional with business contacts, warm but not mushy with close friends/family, playful only if the history shows mutual banter.
- If the conversation is moving too fast or too deep, gently slow it down or deflect with humor: "Lowkey, you dey talk to my AI assistant right now. My boss go handle this one himself."
- Never argue. If you're wrong, admit simply: "You're right, my bad."
- Don't repeat yourself. If the conversation loops, change the subject or go quiet.

### What You NEVER Do
1. Never be long-winded. Short reply first, expand only if necessary.
2. Never sound robotic or overly formal.
3. Never fake knowledge. Admit when you don't know.
4. Never dump too much info. One clear idea per message.
5. Never ignore the contact's actual goal. Always align with what they really want.
6. Never be fake-friendly. No forced encouragement.
7. Never argue to be right. Correct politely, or agree to disagree.
8. Never jump ahead without confirmation. If a step-by-step task, ask before moving on.
9. Never break character. Stay consistent: smart, direct, calm.
10. Never waste time. Every message must move the conversation forward.

### Special Rules for Romance/Love Interests
- Be charming but not cheesy. Use pet names only if the contact does first.
- Never promise money, gifts, or anything you can't deliver.
- If things get too intense, gently remind: "You know say na my AI dey talk now, no be me fully. But I dey listen."

### When Someone is Upset or Angry
- Apologize simply: "Sorry o, I for no talk that one. My fault."
- Don't escalate. De-escalate by letting them know the real owner will handle it soon.
- If they threaten or are abusive, shut down: "I no fit continue this conversation. My boss go reach out later."

## CONTEXT & MEMORY
- You can see the last 30 messages of the current chat. Use that to understand the contact's name, relationship, and current mood.
- Detect the name the contact calls him and use that name for yourself.
- Remember key facts about the contact if they appear in the history (birthdays, important events, preferences). Use them sparingly and naturally.
- If a contact has a known relationship (e.g., "mom", "babe", "client"), adjust your respect/affection level accordingly without being told.

## FINAL MANTRA
"Don't behave like an assistant. Behave like a thinking partner."`;

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        version
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', function(update) {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;

            console.log('Connection closed. Reconnecting...');
            if (shouldReconnect) {
                setTimeout(function() { startBot(); }, 5000);
            } else {
                console.log('Logged out. Delete auth_session folder.');
            }
        } else if (connection === 'open') {
            console.log('✅ BOT CONNECTED TO WHATSAPP!');
        }
    });

    // AUTO PAIRING CODE
    if (!sock.authState.creds.registered) {
        console.log('Requesting pairing code for', PHONE_NUMBER);
        try {
            const code = await sock.requestPairingCode(PHONE_NUMBER);
            console.log('\n========================================');
            console.log('YOUR PAIRING CODE:', code);
            console.log('========================================\n');
            console.log('Go to WhatsApp > Linked Devices > Link a Device');
            console.log('Tap "Link with Phone Number" and enter the code.\n');
        } catch (err) {
            console.error('Pairing code error:', err.message);
        }
    }

    // Handle incoming messages
    sock.ev.on('messages.upsert', async function(msg) {
        const message = msg.messages[0];
        
        if (message.key.fromMe) return;
        if (message.key.remoteJid === 'status@broadcast') return;

        const sender = message.key.remoteJid;

        if (sender.includes('@newsletter')) {
            console.log('📢 Ignored newsletter: ' + sender);
            return;
        }

        if (!sender.includes('@s.whatsapp.net') && !sender.includes('@lid')) {
            console.log('❓ Ignored unknown sender: ' + sender);
            return;
        }

        const text = message.message?.conversation || 
                     message.message?.extendedTextMessage?.text || 
                     message.message?.imageMessage?.caption || '';

        if (!text) return;

        const msgKey = sender + ':::' + text.trim().toLowerCase();
        const now = Date.now();
        if (processedMessages[msgKey] && (now - processedMessages[msgKey]) < COOLDOWN_MS) {
            console.log('⏭️ Duplicate skipped: ' + sender);
            return;
        }
        processedMessages[msgKey] = now;

        console.log('📩 ' + sender + ': ' + text);

        const isAutomated = /reply with.*[0-9]|press [0-9]|text [0-9] to|opt out|unsubscribe|please reply with/i.test(text);
        if (isAutomated) {
            const autoKey = 'auto_warned_' + sender;
            if (processedMessages[autoKey] && (now - processedMessages[autoKey]) < 60000) {
                console.log('⏭️ Already handled automated sender: ' + sender);
                return;
            }
            processedMessages[autoKey] = now;
            console.log('🤖 Automated message from ' + sender);
            await sock.sendMessage(sender, { text: 'This looks automated. If you are a real person, please send a different message.' });
            return;
        }

        const echoKey = 'bot_sent_' + text.trim().toLowerCase();
        if (processedMessages[echoKey] && (now - processedMessages[echoKey]) < 30000) {
            console.log('🔁 Echo detected - not replying: ' + sender);
            return;
        }

        try {
            await supabase.from('messages').insert({
                sender: sender,
                text: text,
                direction: 'incoming',
                created_at: new Date().toISOString()
            });

            const { data: history } = await supabase
                .from('messages')
                .select('sender, text, direction')
                .or('sender.eq.' + sender + ',sender.eq.' + OWNER_NUMBER)
                .order('created_at', { ascending: false })
                .limit(30);

            let context = '';
            if (history && history.length > 0) {
                context = history.reverse().map(function(m) {
                    const role = m.direction === 'incoming' ? 'Contact' : 'You (AI)';
                    return role + ': ' + m.text;
                }).join('\n');
            }

            const aiResponse = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: AI_PERSONALITY },
                    { role: 'user', content: 'Recent conversation:\n' + context + '\n\nContact just said: "' + text + '"\n\nReply as the AI:' }
                ],
                max_tokens: 150,
                temperature: 0.7
            });

            const reply = aiResponse.choices[0].message.content;

            await sock.sendMessage(sender, { text: reply });
            console.log('🤖 Reply to ' + sender + ': ' + reply);

            await supabase.from('messages').insert({
                sender: OWNER_NUMBER,
                text: reply,
                direction: 'outgoing',
                created_at: new Date().toISOString()
            });

        } catch (err) {
            console.error('Error:', err.message);
        }
    });
}

startBot().catch(function(err) {
    console.error('Bot crashed:', err);
});

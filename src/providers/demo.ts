import type { ModelProvider, ModelInfo, ChatChunk, ChatRequest } from '../types';

// ---- Fake model pool ----
const DEMO_MODELS: ModelInfo[] = [
  { id: 'demo/gpt-4o', name: 'GPT-4o (simulated)', provider: 'openrouter' },
  { id: 'demo/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (simulated)', provider: 'openrouter' },
  { id: 'demo/gemini-2.0-flash', name: 'Gemini 2.0 Flash (simulated)', provider: 'openrouter' },
  { id: 'demo/llama-3.3-70b', name: 'Llama 3.3 70B (simulated)', provider: 'openrouter' },
  { id: 'demo/mistral-large', name: 'Mistral Large (simulated)', provider: 'openrouter' },
  { id: 'demo/qwen-2.5-72b', name: 'Qwen 2.5 72B (simulated)', provider: 'openrouter' },
];

// ---- 15 canned responses (themed so they still feel like real LLM output) ----
const RESPONSES: string[] = [
  `The history of the internet is a fascinating tale of academic research, military necessity, and commercial innovation. It all started in the late 1960s when the U.S. Department of Defense's ARPANET connected four university computers. Packets, rather than circuits, carried data — a revolutionary idea at the time.

By the 1980s, TCP/IP became the standard networking protocol, and the term "internet" entered the lexicon. Tim Berners-Lee's invention of the World Wide Web in 1989 transformed the internet from a researcher's tool into a global platform for information sharing.

The 1990s brought the dot-com boom and bust, but the infrastructure laid during that era — fiber optic cables, data centers, and search engines — became the backbone of today's digital economy.`,

  `Quantum computing represents a paradigm shift in how we process information. Unlike classical bits that are either 0 or 1, quantum bits (qubits) can exist in superposition — effectively both states simultaneously. This allows quantum computers to explore many possible solutions at once.

However, building practical quantum computers faces enormous challenges. Qubits are incredibly fragile, requiring temperatures near absolute zero and isolation from all environmental noise. Error correction is still the field's holy grail.

Despite these hurdles, companies like IBM, Google, and IonQ have demonstrated quantum advantage on specific problems. The long-term potential — from drug discovery to cryptography — keeps investment flowing.`,

  `Photosynthesis is perhaps the most important chemical reaction on Earth. Every year, plants and algae convert roughly 100 billion tons of carbon into biomass using nothing but sunlight, water, and CO₂. The energy captured through photosynthesis powers essentially all life on the planet.

The process occurs in chloroplasts, where chlorophyll molecules absorb photons and kick off a chain of electron transfers. These ultimately drive the Calvin cycle, producing glucose. The oxygen we breathe is merely a byproduct of splitting water molecules.

Scientists are working on artificial photosynthesis, hoping to mimic nature's efficiency for clean fuel production. If successful, we could produce hydrogen from sunlight and water at scales that would rival fossil fuels.`,

  `The Voyager 1 spacecraft, launched in 1977, is the farthest human-made object from Earth. It crossed into interstellar space in August 2012, over 35 years after its launch, and continues to send back data from beyond our solar system's heliopause.

Its famous "Pale Blue Dot" photograph, taken at Carl Sagan's insistence, shows Earth as a tiny speck suspended in a sunbeam. Sagan wrote: "That's here. That's home. That's us. On it everyone you love, everyone you know, everyone you ever heard of, every human being who ever was, lived out their lives."

The spacecraft carries a Golden Record — a time capsule of Earth's sounds, music, and greetings in 55 languages — intended for any extraterrestrial civilization that might one day find it.`,

  `Coffee is the world's most popular psychoactive substance, with over 2 billion cups consumed daily. The Coffea plant originated in Ethiopia, where legend says a goat herder named Kaldi noticed his goats dancing after eating red coffee cherries.

From Ethiopia, coffee spread to Yemen, where Sufi monks used it to stay awake during nocturnal prayers. By the 16th century, coffeehouses had sprung up across the Ottoman Empire, earning the nickname "schools of the wise" for their role as intellectual gathering spaces.

Today, the two main species are Arabica (smoother, more complex) and Robusta (stronger, more bitter). Climate change threatens both: rising temperatures and shifting rain patterns could halve suitable coffee-growing land by 2050.`,

  `The Great Barrier Reef stretches over 2,300 kilometers along Australia's northeast coast — it's the largest living structure on Earth, visible from space. Composed of nearly 3,000 individual reef systems, it supports an extraordinary diversity of marine life.

The reef was formed over 20,000 years and is built by billions of tiny coral polyps, each secreting a calcium carbonate skeleton. The vivid colors come not from the coral animals themselves, but from symbiotic algae (zooxanthellae) living inside their tissues.

Coral bleaching events, driven by warming ocean temperatures, have devastated large sections of the reef. When water stays too warm for too long, corals expel their algae — turning white — and unless temperatures drop, they starve. Conservation efforts now focus on heat-resistant coral strains and reducing local stressors.`,

  `The concept of blockchain emerged from the 2008 Bitcoin whitepaper by the pseudonymous Satoshi Nakamoto. At its core, a blockchain is a distributed ledger where transactions are grouped into blocks, cryptographically chained together, and replicated across a network of nodes.

The innovation wasn't any single technology — hashing, digital signatures, and peer-to-peer networks all existed before — but the clever combination that solved the double-spending problem without needing a trusted third party. Proof-of-work mining secures the network by making it computationally expensive to rewrite history.

Beyond cryptocurrency, blockchain technology has found applications in supply chain tracking, digital identity, and decentralized finance. Critics note that many proposed blockchain use cases would work just as well with a traditional database.`,

  `Vincent van Gogh painted "The Starry Night" in 1889 while staying at the Saint-Paul-de-Mausole asylum in Saint-Rémy-de-Provence. The painting depicts the view from his east-facing window, with an idealized village added from memory, just before sunrise.

The swirling sky, dominated by cypress trees reaching upward like dark flames, reflects van Gogh's emotional turbulence. Recent scientific analysis has shown that the swirl patterns in the sky closely match the mathematical structure of turbulent fluid flow — Kolmogorov's theory of turbulence.

During his lifetime, van Gogh sold only one painting. Today, "The Starry Night" is one of the most recognized artworks in the world, drawing millions of visitors to the Museum of Modern Art in New York each year.`,

  `Memory in the human brain isn't a single process but a collection of systems working in concert. Short-term (working) memory holds about seven items for roughly 20–30 seconds. Long-term memory is divided into explicit (conscious recollection) and implicit (unconscious skills and habits).

The hippocampus plays a central role in consolidating new memories, but memories aren't stored there permanently. Over time, through a process called systems consolidation, memories become distributed across the neocortex. Sleep is critical to this process — during deep sleep, the brain replays the day's experiences at accelerated speed.

Emotionally charged memories tend to stick more firmly, thanks to the amygdala's influence on hippocampal encoding. However, every time we recall a memory, it becomes labile and susceptible to modification — which is why eyewitness testimony is notoriously unreliable.`,

  `The Three-Body Problem in physics asks a deceptively simple question: given three masses interacting through gravity, can we predict their motion? Despite centuries of effort by some of history's greatest mathematicians, there is no general closed-form solution.

Henri Poincaré proved in the 1880s that the system is chaotic — infinitesimally small differences in initial conditions lead to dramatically different outcomes over time. This was one of the earliest discoveries of deterministic chaos and laid the groundwork for chaos theory.

Liu Cixin's sci-fi trilogy "Remembrance of Earth's Past" uses the Three-Body Problem as its central metaphor. The Trisolaran civilization, living in a star system with three suns, faces unpredictable catastrophic climate shifts — driving them to seek a new home on Earth.`,

  `Fermentation is one of humanity's oldest food preservation techniques, dating back over 9,000 years. At its simplest, it's the metabolic process where microorganisms — bacteria, yeast, or molds — convert sugars into acids, gases, or alcohol under anaerobic conditions.

The diversity of fermented foods is staggering: Korean kimchi, German sauerkraut, Japanese miso and soy sauce, Ethiopian injera, Mexican tepache, and countless cheeses and yogurts across every culture. Each reflects a unique microbial ecology shaped by local ingredients and environmental conditions.

Modern research has revealed the profound health benefits of fermented foods. The live cultures can support gut microbiome diversity, while the fermentation process increases the bioavailability of nutrients and produces beneficial compounds like B vitamins and short-chain fatty acids.`,

  `The Antikythera mechanism, discovered in a shipwreck off the Greek island of Antikythera in 1901, is often called the world's first analog computer. Dating from around 100 BCE, this bronze device used a complex system of at least 30 meshing gears to track astronomical cycles.

It could predict solar and lunar eclipses, track the positions of the five known planets, and model the irregular orbit of the Moon using a pin-and-slot mechanism that foreshadowed differential gearing. The level of mechanical sophistication wouldn't be seen again for over a millennium.

CT scanning and 3D modeling in the 2000s revealed previously illegible inscriptions, confirming the device's purpose. Scholars now believe it drew on Babylonian eclipse prediction methods combined with Greek geometric models of planetary motion.`,

  `The immune system is a distributed network of cells, tissues, and organs that defends the body against pathogens while maintaining tolerance to its own cells. The innate immune system provides rapid, non-specific defense — macrophages engulf invaders, and inflammation walls off threats.

The adaptive immune system is slower but exquisitely specific. B cells produce antibodies tailored to specific antigens, while T cells either help orchestrate the response or directly kill infected cells. After an infection, memory B and T cells persist for years or decades, ready to mount a faster response on re-exposure.

Vaccines exploit this immunological memory. By presenting a harmless version of a pathogen, they train the adaptive immune system without causing disease. mRNA vaccines, like those developed for COVID-19, represent a new platform: instead of injecting the antigen itself, they deliver instructions for the body's own cells to produce it.`,

  `The Silk Road wasn't a single road but a sprawling network of trade routes spanning over 6,400 kilometers across Asia, connecting China with the Mediterranean. From roughly 130 BCE until 1453 CE, it carried not just silk but ideas, religions, technologies, and diseases between East and West.

Paper-making spread from China along these routes, reaching the Islamic world by the 8th century and Europe by the 12th. Buddhism traveled from India to China and Japan. Gunpowder, the compass, and algebra (from the Arabic "al-jabr") all moved along these caravan paths.

The route's decline came with the rise of maritime trade — ships could carry more cargo faster and cheaper. The Ottoman Empire's control of Constantinople also forced Europeans to seek sea routes to Asia, inadvertently launching the Age of Discovery.`,

  `Concrete is the most used manufactured material on Earth after water — roughly 30 billion tons are poured every year. The Romans pioneered a form of concrete so durable that structures like the Pantheon, completed in 126 CE, still stand today. Their secret? Volcanic ash that produces a rare mineral called aluminous tobermorite when exposed to seawater.

Modern Portland cement, patented in 1824, is made by heating limestone and clay to 1,450°C, grinding the resulting clinker, and mixing with gypsum. The cement industry accounts for about 8% of global CO₂ emissions — more than aviation.

Researchers are racing to develop low-carbon alternatives: geopolymer cements, carbon-cured concrete that absorbs CO₂ during curing, and even "living" concrete that uses bacteria to heal its own cracks. The challenge is matching the cost, availability, and reliability of a material that quite literally built civilization.`,
];

// ---- Helpers ----
let responseIdx = 0;

function pickNextResponse(): string {
  const r = RESPONSES[responseIdx % RESPONSES.length];
  responseIdx++;
  return r;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- The provider ----
const DEMO_PROVIDER_ID = 'openrouter' as const;

export const demoProvider: ModelProvider = {
  id: DEMO_PROVIDER_ID,
  name: 'Demo',
  needsApiKey: false,

  async fetchModels(): Promise<ModelInfo[]> {
    // Simulate a short network delay
    await sleep(600);
    return [...DEMO_MODELS];
  },

  async *chat(_request: ChatRequest): AsyncGenerator<ChatChunk> {
    const text = pickNextResponse();

    // Simulate per-character streaming — yield DELTAS, not cumulative text,
    // so the arena's `text += chunk.content` builds the response correctly.
    let sent = '';
    for (let i = 0; i < text.length; i++) {
      sent += text[i];
      // Yield every ~6 chars for a chunky-but-fast stream
      if (i % 6 === 0 || i === text.length - 1) {
        const delta = sent;
        sent = '';
        await sleep(15 + Math.random() * 25);
        yield { content: delta, done: false };
      }
    }

    // Final chunk
    yield { content: '', done: true };
  },
};

export { DEMO_MODELS };
{/* main page */}
import Image from "next/image"
import Link from "next/link"
import { Mail, Hash } from "lucide-react"
import { siGoogle, siGithub, siSpotify, siNotion, siStripe, siDiscord } from "simple-icons"

const servers = ["Server 1", "Server 2", "Server 3"]

const premadeServers = [
  { name: "Google",  simpleIcon: siGoogle,   lucideIcon: null },
  { name: "GitHub",  simpleIcon: siGithub,   lucideIcon: null },
  { name: "Spotify", simpleIcon: siSpotify,  lucideIcon: null },
  { name: "Notion",  simpleIcon: siNotion,   lucideIcon: null },
  { name: "Slack",   simpleIcon: null,       lucideIcon: Hash },
  { name: "Stripe",  simpleIcon: siStripe,   lucideIcon: null },
  { name: "Discord", simpleIcon: siDiscord,  lucideIcon: null },
  { name: "Email",   simpleIcon: null,       lucideIcon: Mail },
]

export default function Home() {
  return (
  <div className="min-h-screen">
    <nav className="flex items-center justify-between px-6 pl-20">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} />
        <div className="flex font-[family-name:--font-cinzel]" style={{ gap: "clamp(10px, 4vw, 168px)" }}>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Info
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Keys
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Account
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
        </div>
        <div className="w-[220px]"></div>
    </nav>

    <main className="flex items-center justify-center h-[75vh]">
      <Link href="/create">
        <button className="font-[family-name:--font-cinzel] cursor-pointer px-16 py-8 text-[36px] tracking-widest text-black border-[3px] border-black relative
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none
          hover:bg-black hover:text-white hover:before:border-white transition-colors duration-300">
          Build Your Server
        </button>
      </Link>
    </main>

    {/* your servers section */}
    <section className="px-[250px]">
      <h2 className="font-[family-name:--font-cinzel] text-[42px]">Your Servers</h2>
      <div className="h-[1px] bg-black"></div>
      <div className="flex flex-wrap justify-center gap-6 mt-8 pb-16">
        {servers.map((server) => (
          <div key={server} className="w-[280px] aspect-[4/3] font-[family-name:--font-cinzel] cursor-pointer px-8 py-10 text-[24px] tracking-widest text-black border-[2px] border-gray-400 relative
            before:absolute before:inset-[5px] before:border-[1px] before:border-gray-300 before:pointer-events-none
            hover:border-black hover:before:border-gray-500 transition-colors duration-300">
            {server}
          </div>
        ))}
      </div>
    </section>

    {/* pre-made servers section */}
    <section className="px-[250px] pb-24">
      <h2 className="font-[family-name:--font-cinzel] text-[42px]">Pre-made Servers</h2>
      <div className="h-[1px] bg-black"></div>
      <div className="flex flex-wrap justify-center gap-6 mt-8">
        {premadeServers.map(({ name, simpleIcon, lucideIcon: LucideIcon }) => (
          <div key={name} className="w-[280px] aspect-[4/3] font-[family-name:--font-cinzel] cursor-pointer flex flex-col items-center justify-center gap-4 text-[20px] tracking-widest text-black border-[2px] border-gray-400 relative
            before:absolute before:inset-[5px] before:border-[1px] before:border-gray-300 before:pointer-events-none
            hover:border-black hover:before:border-gray-500 transition-colors duration-300">
            {simpleIcon ? (
              <svg role="img" viewBox="0 0 24 24" width={48} height={48} xmlns="http://www.w3.org/2000/svg">
                <path d={simpleIcon.path} />
              </svg>
            ) : LucideIcon ? (
              <LucideIcon size={48} strokeWidth={1.5} />
            ) : null}
            {name}
          </div>
        ))}
      </div>
    </section>

  </div>
)}

"use client"
import { motion } from "framer-motion"

// Opacity-only — no y transform. Any transform (even translateY(0px) leftover
// after animation) on this wrapper creates a CSS containing block that breaks
// background-attachment:fixed on the blur layers inside every panel.
const variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
}

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}

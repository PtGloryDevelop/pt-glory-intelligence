"use client";

import { useState } from "react";
import { homeCookie, type HomeChoice } from "../lib/home-choice.ts";
import styles from "./HomeChoice.module.css";

/** The server passes the current choice, so the first render already says the right thing (no hydration flash). */
export function HomeChoiceButton({ target, current }: { target: HomeChoice; current: HomeChoice }) {
  const [home, setHome] = useState(current);
  if (home === target) return <span className={styles.isHome} data-testid="home-choice" title="จำไว้ในเครื่องนี้">✓ หน้าแรกของฉัน</span>;
  return <button type="button" className={styles.set} data-testid="home-choice" title="จำไว้ในเครื่องนี้"
    onClick={() => { document.cookie = homeCookie(target); setHome(target); }}>ตั้งเป็นหน้าแรกของฉัน</button>;
}

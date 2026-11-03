import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { LedgerHero } from "./demos/LedgerHero";
import { Features } from "./demos/Features";

const REPO = "https://github.com/night-sornram/taxly";

export function Site() {
  const [run, setRun] = useState(0);
  return (
    <>
      <header className="top">
        <a className="brand" href="/">
          <img src="/app-icon.svg" alt="" width={32} height={32} />
          Taxly
        </a>
        <a className="link" href={REPO}>GitHub</a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">สำหรับคนทำงานกินเงินเดือน · ปีภาษี 2568 / 2569</p>
            <h1>
              <span className="nw">ภาษีและรายรับรายจ่าย</span> <span className="nw soft">ในแอปเดียว</span>
            </h1>
            <p className="lede">จดรายการทุกวัน แล้วดูภาษีทั้งปีโดยประมาณได้ทันที ข้อมูลเก็บในเครื่องของคุณ ซิงก์กับโทรศัพท์เมื่อคุณเปิดใช้</p>
            <div className="actions">
              <a className="btn btn--primary" href={`${REPO}#getting-started`}>วิธีติดตั้งบน Mac</a>
              <a className="btn" href={REPO}>ดูโค้ดบน GitHub</a>
            </div>
          </div>
          <figure className="hero-figure">
            <div id="hero-demo" className="hero-demo">
              <LedgerHero key={run} />
            </div>
            <button type="button" className="replay" onClick={() => setRun((n) => n + 1)}>
              <RotateCcw size={14} strokeWidth={2} aria-hidden />
              เล่นอีกครั้ง
            </button>
          </figure>
        </section>

        <section className="features" id="features">
          <h2>
            <span className="nw">ทุกอย่างที่ต้องใช้</span> <span className="nw">ตั้งแต่จดรายการถึงประมาณภาษี</span>
          </h2>
          <Features />
        </section>
      </main>

      <footer className="foot">
        <p>คำนวณเพื่อประมาณการ ไม่ใช่การยื่นแบบภาษี และไม่ได้ชำระภาษีแทนคุณ</p>
        <p>รุ่นทดลอง · รองรับผู้มีเงินได้คนเดียว อายุต่ำกว่า 65 ปี</p>
      </footer>
    </>
  );
}

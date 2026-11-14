import { BRAND } from '../../brand'
import { Mark } from '../shell/Mark'
import { ExampleReceipt } from './ExampleReceipt'

const STEPS = [
  ['Send one photo', 'Of the empty corner, with what you need and your budget: "a study corner, €300, I\'m in Athens". It asks one thing back, like how wide the wall is.'],
  ['It shops real shops', 'It searches Greek shops, opens each product page and reads the price, the size and the delivery.'],
  ['It checks and decides out loud', 'Anything it cannot prove from the page is dropped. Too wide, over budget, out of stock: rejected, with the reason.'],
  ['You see your room and the receipt', 'Your own photo with exactly those products in it, and a receipt with shop, price, size and link. Swap any item by saying what you want instead.'],
] as const

const SHOPS = ['IKEA', 'JYSK', 'Praktiker', 'Plaisio', 'Pepco']

type Props = {
  /** Live: open the login screen in either mode. Samples: go straight into the app. */
  onLogIn: () => void
  onSignUp?: () => void
}

/** The one page before login: what Roomify does, and the way in. */
export function Landing({ onLogIn, onSignUp }: Props) {
  const primary = onSignUp ? 'Log in' : 'Open the sample rooms'
  const button =
    'press inline-flex h-12 items-center rounded-control bg-primary px-5 text-body font-medium text-surface'

  return (
    <div className="min-h-dvh bg-ground">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Mark />
        <nav className="flex items-center gap-4">
          {onSignUp && (
            <button type="button" onClick={onSignUp} className="hidden h-11 items-center text-chrome font-medium text-ink underline-offset-2 hover:underline sm:inline-flex">
              Create account
            </button>
          )}
          <button type="button" onClick={onLogIn} className="press inline-flex h-11 items-center rounded-control bg-secondary px-4 text-chrome font-medium text-ink">
            {onSignUp ? 'Log in' : 'Open the app'}
          </button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_28rem] lg:py-20">
          <div>
            <h1 className="max-w-xl text-[2.5rem] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[3.25rem]">
              Photograph a room. Get a basket you can actually buy.
            </h1>
            <p className="mt-5 max-w-lg text-[1.125rem] leading-7 text-muted">
              Say what you need and your budget. {BRAND.name} shops real shops near you, rejects what doesn't fit, and
              shows your own room with exactly the products it chose.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <button type="button" onClick={onLogIn} className={button}>
                {primary}
              </button>
              {onSignUp && (
                <button type="button" onClick={onSignUp} className="inline-flex h-12 items-center text-body font-medium text-ink underline underline-offset-4">
                  Create an account
                </button>
              )}
            </div>
          </div>
          <ExampleReceipt />
        </section>

        <section aria-labelledby="how" className="border-t border-border py-12 lg:py-16">
          <h2 id="how" className="text-title font-semibold">
            How it works
          </h2>
          <ol className="mt-6 grid gap-x-10 sm:grid-cols-2">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-4 border-t border-rule py-5">
                <span className="num w-6 shrink-0 text-body font-medium text-muted">{i + 1}</span>
                <div>
                  <h3 className="text-body font-semibold">{title}</h3>
                  <p className="mt-1 text-body text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="shops" className="border-t border-border py-12">
          <h2 id="shops" className="text-title font-semibold">
            Shops it reads
          </h2>
          <p className="mt-3 text-[1.125rem] leading-7">{SHOPS.join(' · ')}</p>
          <p className="mt-2 text-body text-muted">More shops are added as their pages allow it.</p>
        </section>

        <section className="flex flex-col items-start gap-6 border-t border-border py-12 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-title font-semibold">
            Every price, size and link is read from the shop's own page. Nothing is in the picture that you can't buy.
          </p>
          <button type="button" onClick={onLogIn} className={`${button} shrink-0`}>
            {primary}
          </button>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-chrome text-muted sm:px-6">
        {BRAND.name} · Checkout happens on each shop's own site.
      </footer>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import HomeLayout from './components/Home/HomeLayout'
import './App.css'

const slogans = ['Friends.', 'Family.', 'Colleagues.', 'Groups.', 'Humanity.']

function Home() {
  const [sloganIndex, setSloganIndex] = useState(0)
  const [fade, setFade] = useState(false)
  const [brandVisible, setBrandVisible] = useState(false)
  const [sloganGone, setSloganGone] = useState(false)
  const [condensed, setCondensed] = useState(false)

  const cycleCountRef = useRef(0)
  const sloganIndexRef = useRef(0)

  useEffect(() => {
    // Title Fade In
    const titleTimer = setTimeout(() => {
      setBrandVisible(true)
    }, 100)

    // Slogan Rotation
    const rotate = () => {
      setFade(true)

      setTimeout(() => {
        const nextIndex = (sloganIndexRef.current + 1) % slogans.length
        sloganIndexRef.current = nextIndex
        setSloganIndex(nextIndex)
        setFade(false)

        if (nextIndex === slogans.length - 1) {
          cycleCountRef.current++
          if (cycleCountRef.current >= 1) { // Cycle once
            clearInterval(intervalId)
            setTimeout(() => {
              setSloganGone(true)
              // Trigger condensation slightly after slogan starts disappearing
              setTimeout(() => setCondensed(true), 500)
            }, 2000)
          }
        }
      }, 1000)
    }

    const intervalId = setInterval(rotate, 4000)

    return () => {
      clearTimeout(titleTimer)
      clearInterval(intervalId)
    }
  }, [])

  return (
    <HomeLayout>
      <div className="auth-box">
        <div className={`auth-header-brand ${brandVisible ? 'visible' : ''}`}>
          <h1 id="auth-title" className={condensed ? 'condensed' : ''}>
            <span>L</span>
            <span className="collapsible">oca</span>
            <span>l</span>
            <span className="collapsible">Link</span>
            <span>.</span>
          </h1>
          <p className={`auth-slogan ${sloganGone ? 'slogan-gone' : ''}`} id="auth-slogan">
            Connect to <span id="slogan-target" className={fade ? 'slogan-fade' : ''}>{slogans[sloganIndex]}</span>
          </p>
          <Link to="/getting-started" className="enter-link visible small-enter">
            enter
          </Link>
        </div>
      </div>
    </HomeLayout>
  )
}

export default Home

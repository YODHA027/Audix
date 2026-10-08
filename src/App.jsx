import { useState, useEffect, useRef } from 'react'
import './App.css'
import { supabase } from './supabaseClient'

function App() {
  const [screen, setScreen] = useState('login')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const [songs, setSongs] = useState([])
  const [favorites, setFavorites] = useState([])
  const [current, setCurrent] = useState(null)

  const [search, setSearch] = useState('')
  const [artistFilter, setArtistFilter] = useState('All')

  const [showUpload, setShowUpload] = useState(false)

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [audioFile, setAudioFile] = useState(null)
  const [coverFile, setCoverFile] = useState(null)
  const [uploading, setUploading] = useState(false)

  const [showLyrics, setShowLyrics] = useState(false)
  const [deletingSongId, setDeletingSongId] = useState(null)

  // Spotify-style player
  const audioRef = useRef(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  useEffect(() => {
    checkSession()
  }, [])

  useEffect(() => {
    if (screen === 'home') {
      loadSongs()
      loadFavorites()
    }
  }, [screen])

  // When current song changes
  useEffect(() => {
    setShowLyrics(false)

    if (!audioRef.current || !current) return

    setProgress(0)
    setDuration(0)

    audioRef.current.load()

    audioRef.current
      .play()
      .then(() => {
        setIsPlaying(true)
      })
      .catch(() => {
        setIsPlaying(false)
      })
  }, [current])

  async function checkSession() {
    const { data } = await supabase.auth.getSession()

    if (data.session) {
      setScreen('home')
    }
  }

  async function loadSongs() {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setSongs(data || [])
  }

  async function loadFavorites() {
    const { data, error } = await supabase
      .from('favorites')
      .select('song_id')

    if (error) {
      console.error(error)
      return
    }

    setFavorites(
      (data || []).map(item => item.song_id)
    )
  }

  async function register(e) {
    e.preventDefault()

    if (!email || !password) return

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      alert(error.message)
      return
    }

    alert('Account created. Please login.')

    setEmail('')
    setPassword('')
    setScreen('login')
  }

  async function login(e) {
    e.preventDefault()

    if (!email || !password) return

    setLoading(true)

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    setLoading(false)

    if (error) {
      alert(error.message)
      return
    }

    setScreen('home')
  }

  async function logout() {
    if (audioRef.current) {
      audioRef.current.pause()
    }

    await supabase.auth.signOut()

    setCurrent(null)
    setIsPlaying(false)
    setProgress(0)
    setScreen('login')
    setSearch('')
    setArtistFilter('All')
    setShowLyrics(false)
  }

  function musicUrl(path) {
    if (!path) return ''

    return supabase.storage
      .from('music')
      .getPublicUrl(path)
      .data.publicUrl
  }

  function coverUrl(path) {
    if (!path) return ''

    return supabase.storage
      .from('artwork')
      .getPublicUrl(path)
      .data.publicUrl
  }

  // =========================================
  // FAVORITES
  // =========================================

  async function toggleFavorite(e, song) {
    e.stopPropagation()

    const isFavorite = favorites.includes(song.id)

    if (isFavorite) {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('song_id', song.id)

      if (error) {
        alert(error.message)
        return
      }

      setFavorites(prev =>
        prev.filter(id => id !== song.id)
      )

      return
    }

    const { error } = await supabase
      .from('favorites')
      .insert({
        song_id: song.id,
      })

    if (error) {
      alert(error.message)
      return
    }

    setFavorites(prev => [
      ...prev,
      song.id,
    ])
  }

  // =========================================
  // DELETE SONG
  // =========================================

  async function deleteSong(e, song) {
    e.stopPropagation()

    if (deletingSongId) return

    const confirmed = window.confirm(
      `Delete "${song.title}"?`
    )

    if (!confirmed) return

    setDeletingSongId(song.id)

    // Stop the player immediately if this is the current song.
    if (current?.id === song.id) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }

      setCurrent(null)
      setIsPlaying(false)
      setProgress(0)
      setDuration(0)
      setShowLyrics(false)
    }

    // Remove references first so the songs row can be deleted cleanly.
    const { error: playlistError } = await supabase
      .from('playlist_songs')
      .delete()
      .eq('song_id', song.id)

    if (playlistError) {
      console.error('playlist_songs delete failed:', playlistError)
    }

    const { error: favoriteError } = await supabase
      .from('favorites')
      .delete()
      .eq('song_id', song.id)

    if (favoriteError) {
      console.error('favorites delete failed:', favoriteError)
    }

    // Delete the database row first. This is the important operation.
    const { error: songError } = await supabase
      .from('songs')
      .delete()
      .eq('id', song.id)

    if (songError) {
      console.error('songs delete failed:', songError)
      alert(`Could not delete song: ${songError.message}`)
      setDeletingSongId(null)
      return
    }

    // Remove it from the UI immediately after the DB confirms deletion.
    setSongs(prev =>
      prev.filter(item => item.id !== song.id)
    )

    setFavorites(prev =>
      prev.filter(id => id !== song.id)
    )

    // Clean up Storage files. A Storage failure should not bring the song
    // back into the UI because the database row is already deleted.
    if (song.file_path) {
      const { error: musicError } = await supabase.storage
        .from('music')
        .remove([song.file_path])

      if (musicError) {
        console.error('music file delete failed:', musicError)
      }
    }

    if (song.artwork_path) {
      const { error: artworkError } = await supabase.storage
        .from('artwork')
        .remove([song.artwork_path])

      if (artworkError) {
        console.error('artwork delete failed:', artworkError)
      }
    }

    setDeletingSongId(null)
  }

  // =========================================
  // AUTOMATIC LYRICS
  // =========================================

  async function fetchLyrics(songTitle, songArtist) {
    try {
      const title = songTitle.trim()
      const artist = songArtist.trim()

      // 1. LRCLIB exact match
      const exactParams = new URLSearchParams({
        track_name: title,
        artist_name: artist,
      })

      const exactResponse = await fetch(
        `https://lrclib.net/api/get?${exactParams.toString()}`
      )

      if (exactResponse.ok) {
        const exactData = await exactResponse.json()

        const exactLyrics =
          exactData.plainLyrics ||
          exactData.syncedLyrics
            ?.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/g, '') ||
          ''

        if (exactLyrics.trim()) {
          console.log('Lyrics found with LRCLIB exact match')
          return exactLyrics.trim()
        }
      }

      // 2. LRCLIB search fallback
      const searchResponse = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(
          `${title} ${artist}`
        )}`
      )

      if (searchResponse.ok) {
        const results = await searchResponse.json()

        if (Array.isArray(results) && results.length > 0) {
          const normalizedTitle = title.toLowerCase().trim()
          const normalizedArtist = artist.toLowerCase().trim()

          const exactSearchMatch = results.find(item =>
            item.trackName?.toLowerCase().trim() === normalizedTitle &&
            item.artistName?.toLowerCase().trim() === normalizedArtist
          )

          const match = exactSearchMatch || results[0]

          const lyrics =
            match.plainLyrics ||
            match.syncedLyrics
              ?.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/g, '') ||
            ''

          if (lyrics.trim()) {
            console.log('Lyrics found with LRCLIB search')
            return lyrics.trim()
          }
        }
      }

      // 3. lyrics.ovh fallback
      const lyricsOvhResponse = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(
          artist
        )}/${encodeURIComponent(title)}`
      )

      if (lyricsOvhResponse.ok) {
        const lyricsOvhData = await lyricsOvhResponse.json()

        if (lyricsOvhData?.lyrics?.trim()) {
          console.log('Lyrics found with lyrics.ovh')
          return lyricsOvhData.lyrics.trim()
        }
      }

      console.log('No lyrics found from available automatic providers:', {
        title,
        artist,
      })

      return ''
    } catch (error) {
      console.error('Lyrics lookup failed:', error)
      return ''
    }
  }

  // =========================================
  // UPLOAD SONG
  // =========================================

  async function uploadSong(e) {
    e.preventDefault()

    if (!audioFile) {
      alert('Choose an audio file.')
      return
    }

    if (!title.trim()) {
      alert('Enter song title.')
      return
    }

    if (!artist.trim()) {
      alert('Enter artist name.')
      return
    }

    setUploading(true)

    const cleanName = name =>
      name.replace(/[^a-zA-Z0-9._-]/g, '_')

    const audioPath =
      `${Date.now()}-${cleanName(audioFile.name)}`

    const { error: audioError } =
      await supabase.storage
        .from('music')
        .upload(audioPath, audioFile)

    if (audioError) {
      alert(audioError.message)
      setUploading(false)
      return
    }

    let artworkPath = null

    if (coverFile) {
      artworkPath =
        `${Date.now()}-${cleanName(coverFile.name)}`

      const { error: artworkError } =
        await supabase.storage
          .from('artwork')
          .upload(
            artworkPath,
            coverFile
          )

      if (artworkError) {
        await supabase.storage
          .from('music')
          .remove([audioPath])

        alert(artworkError.message)
        setUploading(false)
        return
      }
    }

    // Automatically find lyrics after the audio/artwork upload.
    const songTitle = title.trim()
    const songArtist = artist.trim()
    const automaticLyrics = await fetchLyrics(
      songTitle,
      songArtist
    )

    const { error } =
      await supabase
        .from('songs')
        .insert({
          title: songTitle,
          artist: songArtist,
          file_path: audioPath,
          artwork_path: artworkPath,
          lyrics: automaticLyrics || null,
        })

    if (error) {
      await supabase.storage
        .from('music')
        .remove([audioPath])

      if (artworkPath) {
        await supabase.storage
          .from('artwork')
          .remove([artworkPath])
      }

      alert(error.message)
      setUploading(false)
      return
    }

    setTitle('')
    setArtist('')
    setAudioFile(null)
    setCoverFile(null)

    setShowUpload(false)

    await loadSongs()

    setUploading(false)

    alert('Song uploaded successfully.')
  }

  // =========================================
  // PLAYER
  // =========================================

  function togglePlay() {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true)
        })
        .catch(() => {})
    }
  }

  function handleTimeUpdate() {
    if (!audioRef.current) return

    setProgress(
      audioRef.current.currentTime
    )
  }

  function handleLoadedMetadata() {
    if (!audioRef.current) return

    setDuration(
      audioRef.current.duration
    )

    audioRef.current.volume = volume
  }

  function seekSong(e) {
    const value = Number(e.target.value)

    if (!audioRef.current) return

    audioRef.current.currentTime = value
    setProgress(value)
  }

  function changeVolume(e) {
    const value = Number(e.target.value)

    setVolume(value)

    if (audioRef.current) {
      audioRef.current.volume = value
    }
  }

  function formatTime(seconds) {
    if (!seconds || Number.isNaN(seconds)) {
      return '0:00'
    }

    const minutes = Math.floor(
      seconds / 60
    )

    const secs = Math.floor(
      seconds % 60
    )

    return `${minutes}:${secs
      .toString()
      .padStart(2, '0')}`
  }

  function closePlayer() {
    if (audioRef.current) {
      audioRef.current.pause()
    }

    setCurrent(null)
    setIsPlaying(false)
    setProgress(0)
    setShowLyrics(false)
  }

  // =========================================
  // FILTERS
  // =========================================

  const artists = [
    ...new Set(
      songs
        .map(song => song.artist)
        .filter(Boolean)
    ),
  ]

  const filteredSongs = songs.filter(song => {
    const query =
      search.toLowerCase().trim()

    const matchesSearch =
      !query ||
      song.title
        ?.toLowerCase()
        .includes(query) ||
      song.artist
        ?.toLowerCase()
        .includes(query)

    let matchesFilter = true

    if (artistFilter === 'Favorites') {
      matchesFilter =
        favorites.includes(song.id)
    } else if (
      artistFilter !== 'All'
    ) {
      matchesFilter =
        song.artist === artistFilter
    }

    return (
      matchesSearch &&
      matchesFilter
    )
  })

  const currentIndex = current
    ? filteredSongs.findIndex(
        song =>
          song.id === current.id
      )
    : -1

  function nextSong() {
    if (!filteredSongs.length) return

    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) %
          filteredSongs.length
        : 0

    setCurrent(
      filteredSongs[nextIndex]
    )
  }

  function previousSong() {
    if (!filteredSongs.length) return

    const previousIndex =
      currentIndex <= 0
        ? filteredSongs.length - 1
        : currentIndex - 1

    setCurrent(
      filteredSongs[previousIndex]
    )
  }

  function selectFilter(filter) {
    setArtistFilter(filter)

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  // =========================================
  // LOGIN
  // =========================================

  if (screen === 'login') {
    return (
      <div className="auth-page">

        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />

        <div className="auth-content">

          <div className="auth-top">
            <span>AUDIX</span>
            <span>001</span>
          </div>

          <div className="auth-label">
            DIGITAL MUSIC PLATFORM
          </div>

          <h1 className="auth-title">
            LISTEN
            <span>DIFFERENT.</span>
          </h1>

          <p className="auth-description">
            Your music. Your artists.
            <br />
            Your space.
          </p>

          <form
            className="auth-form"
            onSubmit={login}
          >

            <div className="input-wrap">
              <span>01</span>

              <input
                type="email"
                placeholder="EMAIL ADDRESS"
                value={email}
                onChange={e =>
                  setEmail(e.target.value)
                }
                required
              />
            </div>

            <div className="input-wrap">
              <span>02</span>

              <input
                type="password"
                placeholder="PASSWORD"
                value={password}
                onChange={e =>
                  setPassword(e.target.value)
                }
                required
              />
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={loading}
            >
              <span>
                {loading
                  ? 'ENTERING'
                  : 'ENTER AUDIX'}
              </span>

              <span>↗</span>
            </button>

          </form>

          <div className="auth-switch">

            <span>
              DON'T HAVE AN ACCOUNT?
            </span>

            <button
              onClick={() =>
                setScreen('register')
              }
            >
              CREATE ACCOUNT
            </button>

          </div>

        </div>

        <div className="auth-footer">
          <span>EST. 2026</span>
          <span>
            MUSIC / ART / SOUND
          </span>
        </div>

      </div>
    )
  }

  // =========================================
  // REGISTER
  // =========================================

  if (screen === 'register') {
    return (
      <div className="auth-page">

        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />

        <div className="auth-content">

          <div className="auth-top">
            <span>AUDIX</span>
            <span>002</span>
          </div>

          <div className="auth-label">
            JOIN THE PLATFORM
          </div>

          <h1 className="auth-title">
            MAKE
            <span>NOISE.</span>
          </h1>

          <p className="auth-description">
            Create your account and
            <br />
            start building your sound.
          </p>

          <form
            className="auth-form"
            onSubmit={register}
          >

            <div className="input-wrap">
              <span>01</span>

              <input
                type="email"
                placeholder="EMAIL ADDRESS"
                value={email}
                onChange={e =>
                  setEmail(e.target.value)
                }
                required
              />
            </div>

            <div className="input-wrap">
              <span>02</span>

              <input
                type="password"
                placeholder="CREATE PASSWORD"
                value={password}
                onChange={e =>
                  setPassword(e.target.value)
                }
                required
              />
            </div>

            <button
              type="submit"
              className="auth-button"
              disabled={loading}
            >
              <span>
                {loading
                  ? 'CREATING'
                  : 'CREATE ACCOUNT'}
              </span>

              <span>↗</span>
            </button>

          </form>

          <div className="auth-switch">

            <span>
              ALREADY A MEMBER?
            </span>

            <button
              onClick={() =>
                setScreen('login')
              }
            >
              LOGIN
            </button>

          </div>

        </div>

        <div className="auth-footer">
          <span>AUDIX / 002</span>
          <span>
            WELCOME TO THE SOUND
          </span>
        </div>

      </div>
    )
  }

  // =========================================
  // HOME
  // =========================================

  return (
    <div className="site">

      {/* HEADER */}

      <header className="top-header">

        <div
          className="logo"
          onClick={() =>
            selectFilter('All')
          }
        >
          AUDIX
          <sup>®</sup>
        </div>

        <div className="header-center">
          <span>
            DIGITAL MUSIC / 2026
          </span>
        </div>

        <nav className="desktop-nav">

          <button
            className={
              artistFilter === 'All'
                ? 'nav-active'
                : ''
            }
            onClick={() =>
              selectFilter('All')
            }
          >
            HOME
          </button>

          <button
            className={
              artistFilter === 'Favorites'
                ? 'nav-active'
                : ''
            }
            onClick={() =>
              selectFilter('Favorites')
            }
          >
            FAVOURITES
          </button>

          <button
            onClick={() =>
              setShowUpload(!showUpload)
            }
          >
            {showUpload
              ? 'CLOSE'
              : 'UPLOAD'}
          </button>

          <button onClick={logout}>
            EXIT ↗
          </button>

        </nav>

      </header>


      <main>

        {/* HERO */}

        <section className="hero">

          <div className="hero-meta">

            <span>
              001 / AUDIX
            </span>

            <span>
              {songs.length
                .toString()
                .padStart(2, '0')}{' '}
              TRACKS ONLINE
            </span>

          </div>

          <div className="hero-title">

            <div className="hero-solid">
              SOUNDS
            </div>

            <div className="hero-outline">
              WITHOUT
            </div>

            <div className="hero-solid">
              LIMITS.
            </div>

          </div>

          <div className="hero-bottom">

            <div className="hero-description">

              <span className="hero-plus">
                +
              </span>

              <p>
                A DIGITAL SPACE FOR
                <br />
                MUSIC, ARTISTS &
                <br />
                OBSESSIONS.
              </p>

            </div>

            <div className="hero-scroll">
              SCROLL
              <span>↓</span>
            </div>

          </div>

        </section>


        {/* DISCOVER */}

        <section className="discover section">

          <div className="section-top">

            <span>
              02 / DISCOVER
            </span>

            <span>
              {filteredSongs.length} RESULTS
            </span>

          </div>

          <div className="search-container">

            <span className="search-number">
              SEARCH
            </span>

            <input
              className="big-search"
              placeholder="SEARCH MUSIC..."
              value={search}
              onChange={e =>
                setSearch(e.target.value)
              }
            />

            <span className="search-arrow">
              ↗
            </span>

          </div>


          <div className="artists-row">

            <button
              className={
                artistFilter === 'All'
                  ? 'artist-filter active'
                  : 'artist-filter'
              }
              onClick={() =>
                selectFilter('All')
              }
            >
              ALL
            </button>

            <button
              className={
                artistFilter === 'Favorites'
                  ? 'artist-filter active'
                  : 'artist-filter'
              }
              onClick={() =>
                selectFilter('Favorites')
              }
            >
              ♥ FAVOURITES
            </button>

            {artists.map(name => (
              <button
                key={name}
                className={
                  artistFilter === name
                    ? 'artist-filter active'
                    : 'artist-filter'
                }
                onClick={() =>
                  selectFilter(name)
                }
              >
                {name}
              </button>
            ))}

          </div>

        </section>


        {/* UPLOAD */}

        {showUpload && (
          <section className="upload-section section">

            <div className="section-top">

              <span>
                03 / UPLOAD
              </span>

              <span>
                PUBLISH YOUR SOUND
              </span>

            </div>

            <div className="upload-heading">

              <h2>
                PUT YOUR
                <span>MUSIC HERE.</span>
              </h2>

            </div>


            <form
              className="upload-form"
              onSubmit={uploadSong}
            >

              <div className="upload-input">

                <label>
                  01 / TITLE
                </label>

                <input
                  placeholder="SONG TITLE"
                  value={title}
                  onChange={e =>
                    setTitle(e.target.value)
                  }
                  required
                />

              </div>


              <div className="upload-input">

                <label>
                  02 / ARTIST
                </label>

                <input
                  placeholder="ARTIST NAME"
                  value={artist}
                  onChange={e =>
                    setArtist(e.target.value)
                  }
                  required
                />

              </div>


              <label className="file-box">

                <span>
                  03 / AUDIO
                </span>

                <strong>
                  {audioFile
                    ? audioFile.name
                    : 'CHOOSE AUDIO FILE'}
                </strong>

                <input
                  type="file"
                  accept="audio/*"
                  onChange={e =>
                    setAudioFile(
                      e.target.files?.[0] ||
                      null
                    )
                  }
                  required
                />

                <b>+</b>

              </label>


              <label className="file-box">

                <span>
                  04 / COVER
                </span>

                <strong>
                  {coverFile
                    ? coverFile.name
                    : 'CHOOSE COVER ART'}
                </strong>

                <input
                  type="file"
                  accept="image/*"
                  onChange={e =>
                    setCoverFile(
                      e.target.files?.[0] ||
                      null
                    )
                  }
                />

                <b>+</b>

              </label>


              <button
                type="submit"
                className="publish-button"
                disabled={uploading}
              >

                <span>
                  {uploading
                    ? 'UPLOADING...'
                    : 'PUBLISH TRACK'}
                </span>

                <span>↗</span>

              </button>

            </form>

          </section>
        )}


        {/* MUSIC */}

        <section className="music-section section">

          <div className="section-top">

            <span>
              04 / SELECTED TRACKS
            </span>

            <span>
              {filteredSongs.length} TRACKS
            </span>

          </div>


          <div className="track-grid">

            {filteredSongs.map(
              (song, index) => (

                <article
                  className={
                    current?.id === song.id
                      ? 'track active-track'
                      : 'track'
                  }
                  key={song.id}
                  onClick={() =>
                    setCurrent(song)
                  }
                >

                  <div className="track-image">

                    {song.artwork_path ? (
                      <img
                        src={coverUrl(
                          song.artwork_path
                        )}
                        alt={song.title}
                      />
                    ) : (
                      <div className="no-cover">
                        <span>AUDIX</span>
                        <small>
                          NO ARTWORK
                        </small>
                      </div>
                    )}

                    <div className="track-number">
                      {String(
                        index + 1
                      ).padStart(2, '0')}
                    </div>

                    <div className="track-play">
                      {current?.id === song.id
                        ? 'Ⅱ'
                        : '▶'}
                    </div>

                  </div>


                  <div className="track-info">

                    <div className="track-title-wrap">

                      <h2>
                        {song.title}
                      </h2>

                      <p>
                        {song.artist}
                      </p>

                    </div>


                    <div className="track-actions">

                      <button
                        title="Favorite"
                        onClick={e =>
                          toggleFavorite(
                            e,
                            song
                          )
                        }
                      >
                        {favorites.includes(
                          song.id
                        )
                          ? '♥'
                          : '♡'}
                      </button>


                      <button
                        className="delete"
                        title={
                          deletingSongId === song.id
                            ? 'Deleting...'
                            : 'Delete'
                        }
                        disabled={deletingSongId === song.id}
                        onClick={e =>
                          deleteSong(
                            e,
                            song
                          )
                        }
                      >
                        {deletingSongId === song.id ? '…' : '×'}
                      </button>

                    </div>

                  </div>

                </article>

              )
            )}

          </div>


          {filteredSongs.length === 0 && (

            <div className="empty">

              <span>404</span>

              <p>
                NO TRACKS FOUND.
              </p>

              {search && (
                <button
                  onClick={() => {
                    setSearch('')
                    setArtistFilter('All')
                  }}
                >
                  CLEAR SEARCH →
                </button>
              )}

            </div>

          )}

        </section>


        {/* ARTISTS */}

        <section className="artists-section section">

          <div className="section-top">

            <span>
              05 / ARTISTS
            </span>

            <span>
              THE PEOPLE BEHIND THE SOUND
            </span>

          </div>


          <div className="artist-big-grid">

            {artists.map(name => {

              const artistSong =
                songs.find(
                  song =>
                    song.artist === name &&
                    song.artwork_path
                )

              const artistCount =
                songs.filter(
                  song =>
                    song.artist === name
                ).length

              return (

                <div
                  className="artist-big"
                  key={name}
                  onClick={() =>
                    selectFilter(name)
                  }
                >

                  <div className="artist-image">

                    {artistSong ? (
                      <img
                        src={coverUrl(
                          artistSong.artwork_path
                        )}
                        alt={name}
                      />
                    ) : (
                      <div className="artist-placeholder">
                        +
                      </div>
                    )}

                  </div>


                  <div className="artist-big-info">

                    <div>

                      <span>
                        ARTIST
                      </span>

                      <h3>
                        {name}
                      </h3>

                    </div>


                    <div className="artist-count">

                      {artistCount
                        .toString()
                        .padStart(2, '0')}

                      {' '}TRACKS

                      <br />

                      ↗

                    </div>

                  </div>

                </div>

              )
            })}

          </div>

        </section>

      </main>


      {/* FOOTER */}

      <footer className="footer">

        <div className="footer-big">
          AUDIX
        </div>

        <div className="footer-line" />

        <div className="footer-bottom">

          <span>
            © 2026 AUDIX
          </span>

          <span>
            MUSIC / ART / SOUND
          </span>

          <span>
            MADE FOR LISTENERS
          </span>

        </div>

      </footer>


      {/* =========================================
          SPOTIFY STYLE PLAYER
      ========================================= */}

      {current && (

        <div className="spotify-player">

          {/* SONG INFO */}

          <div className="player-song">

            <div className="player-cover">

              {current.artwork_path ? (
                <img
                  src={coverUrl(
                    current.artwork_path
                  )}
                  alt={current.title}
                />
              ) : (
                <div className="player-cover-empty">
                  A
                </div>
              )}

            </div>


            <div className="player-song-info">

              <strong>
                {current.title}
              </strong>

              <span>
                {current.artist}
              </span>

            </div>


            <button
              className="player-like"
              onClick={e =>
                toggleFavorite(
                  e,
                  current
                )
              }
            >
              {favorites.includes(
                current.id
              )
                ? '♥'
                : '♡'}
            </button>

          </div>


          {/* CENTER PLAYER */}

          <div className="player-main">

            <div className="player-controls">

              <button
                onClick={previousSong}
                className="player-control"
                title="Previous"
              >
                ⏮
              </button>


              <button
                onClick={togglePlay}
                className="player-play"
                title={
                  isPlaying
                    ? 'Pause'
                    : 'Play'
                }
              >
                {isPlaying
                  ? 'Ⅱ'
                  : '▶'}
              </button>


              <button
                onClick={nextSong}
                className="player-control"
                title="Next"
              >
                ⏭
              </button>

            </div>


            <div className="player-progress">

              <span>
                {formatTime(progress)}
              </span>


              <input
                type="range"
                min="0"
                max={duration || 0}
                value={progress}
                onChange={seekSong}
                className="progress-range"
              />


              <span>
                {formatTime(duration)}
              </span>

            </div>

          </div>


          {/* VOLUME */}

          <div className="player-volume">

            <span>
              {volume === 0
                ? '🔇'
                : '🔊'}
            </span>


            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={changeVolume}
              className="volume-range"
            />


            <button
              className="player-lyrics"
              onClick={() => setShowLyrics(true)}
              disabled={!current.lyrics}
              title={current.lyrics ? 'Show lyrics' : 'Lyrics not found'}
            >
              LYRICS
            </button>

            <button
              className="player-close"
              onClick={closePlayer}
              title="Close player"
            >
              ×
            </button>

          </div>


          {showLyrics && (
            <div className="lyrics-overlay">

              <div className="lyrics-panel">

                <div className="lyrics-header">
                  <div>
                    <span>LYRICS</span>
                    <h2>{current.title}</h2>
                    <p>{current.artist}</p>
                  </div>

                  <button
                    onClick={() => setShowLyrics(false)}
                    title="Close lyrics"
                  >
                    ×
                  </button>
                </div>

                <div className="lyrics-content">
                  {current.lyrics ? (
                    current.lyrics.split('\n').map((line, index) => (
                      <p key={index}>
                        {line || '\u00a0'}
                      </p>
                    ))
                  ) : (
                    <p>LYRICS NOT AVAILABLE.</p>
                  )}
                </div>

              </div>

            </div>
          )}


          {/* HIDDEN REAL AUDIO */}

          <audio
            ref={audioRef}
            src={musicUrl(
              current.file_path
            )}
            onTimeUpdate={
              handleTimeUpdate
            }
            onLoadedMetadata={
              handleLoadedMetadata
            }
            onPlay={() =>
              setIsPlaying(true)
            }
            onPause={() =>
              setIsPlaying(false)
            }
            onEnded={() => {
              setIsPlaying(false)
              nextSong()
            }}
          />

        </div>

      )}

    </div>
  )
}

export default App
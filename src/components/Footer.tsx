// Attribution and notices (SPEC 12). Always visible.

export default function Footer() {
  return (
    <footer className="footer">
      <span>© OpenStreetMap-Mitwirkende (ODbL)</span>
      <span>OpenFreeMap © OpenMapTiles</span>
      <span>Fahrplandaten: Wiener Linien (CC BY), ÖBB-Personenverkehr AG (CC BY 4.0)</span>
      <span>Bezirksgrenzen: Stadt Wien – data.wien.gv.at (CC BY 4.0)</span>
      <span>Fußwege: FOSSGIS OSRM</span>
      <span>Öffi-Strecken: <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transitous</a></span>
      <span>Tags sind subjektive Einschätzungen.</span>
    </footer>
  )
}

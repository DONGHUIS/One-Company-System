// ── Google Maps Embed 길찾기 ──
const MAPS_API_KEY = "AIzaSyC_vSHypRfOi7AG6D-rRu71x9Piced0vVU";
let currentTravelMode = "driving";

function initMapsCard() {
  const container = document.getElementById("mapsContainer");
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%;height:100%;border:none;";
  iframe.allowFullscreen = true;
  iframe.src = `https://www.google.com/maps/embed/v1/view?key=${MAPS_API_KEY}&center=37.5665,126.9780&zoom=12&language=ko`;
  container.innerHTML = "";
  container.appendChild(iframe);
}

function setTravelMode(btn) {
  document.querySelectorAll(".maps-mode-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentTravelMode = btn.dataset.mode;
}

function setMyLocation() {
  if (!navigator.geolocation) return alert("위치 정보를 사용할 수 없습니다.");
  const btn = document.querySelector(".maps-myloc-btn");
  btn.textContent = "⏳";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`,
          { headers: { "Accept-Language": "ko" } }
        );
        const data = await res.json();
        const a = data.address || {};
        const address =
          a.road
            ? `${a.city || a.county || a.state || ""} ${a.suburb || a.neighbourhood || ""} ${a.road}${a.house_number ? " " + a.house_number : ""}`.trim()
            : data.display_name?.split(",").slice(0, 3).join(" ").trim() || `${lat.toFixed(5)},${lng.toFixed(5)}`;
        document.getElementById("mapsOrigin").value = address;
      } catch {
        document.getElementById("mapsOrigin").value = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      }
      btn.textContent = "📍";
    },
    () => {
      alert("위치 권한을 허용해주세요.");
      btn.textContent = "📍";
    }
  );
}

function searchDirections() {
  const origin = document.getElementById("mapsOrigin").value.trim();
  const destination = document.getElementById("mapsDestination").value.trim();
  const infoEl = document.getElementById("mapsRouteInfo");
  const container = document.getElementById("mapsContainer");

  if (!origin) return alert("출발지를 입력하세요.");
  if (!destination) return alert("목적지를 입력하세요.");

  const params = new URLSearchParams({
    key: MAPS_API_KEY,
    origin,
    destination,
    mode: currentTravelMode.toLowerCase(),
    language: "ko",
    region: "KR",
  });

  const src = `https://www.google.com/maps/embed/v1/directions?${params}`;

  let iframe = container.querySelector("iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    iframe.allowFullscreen = true;
    container.innerHTML = "";
    container.appendChild(iframe);
  }
  iframe.src = src;

  const modeMap = { driving: "자동차", transit: "대중교통", walking: "도보", bicycling: "자전거" };
  const modeLabel = modeMap[currentTravelMode.toLowerCase()] || currentTravelMode;
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${currentTravelMode.toLowerCase()}`;

  infoEl.innerHTML = `
    <div class="maps-route-summary">
      <span class="maps-route-from">${origin}</span>
      <span class="maps-route-arrow">→</span>
      <span class="maps-route-to">${destination}</span>
      <span class="maps-route-mode">${modeLabel}</span>
      <a class="maps-detail-btn" href="${gmapsUrl}" target="_blank" rel="noopener">🗺 상세 경로 보기</a>
    </div>`;
  infoEl.style.display = "block";
}

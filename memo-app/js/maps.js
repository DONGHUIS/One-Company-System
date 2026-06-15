// ── 카카오맵 길찾기 ──
let kakaoMap = null;
let currentTravelMode = "DRIVING";
let markers = [];
let polylines = [];

function initMapsCard() {
  if (kakaoMap) return;
  if (!window.kakao || !window.kakao.maps) {
    setTimeout(initMapsCard, 300);
    return;
  }
  kakao.maps.load(() => {
    renderMap();
  });
}

function renderMap() {
  const container = document.getElementById("mapsContainer");
  container.innerHTML = "";
  const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 7 };
  kakaoMap = new kakao.maps.Map(container, options);
}

function setTravelMode(btn) {
  document.querySelectorAll(".maps-mode-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentTravelMode = btn.dataset.mode;
}

function setMyLocation() {
  if (!navigator.geolocation) {
    Swal.fire({ icon: "error", title: "위치 정보를 사용할 수 없습니다." });
    return;
  }
  const btn = document.querySelector(".maps-myloc-btn");
  btn.textContent = "⏳";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.coord2Address(lng, lat, (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
          const addr = result[0].road_address
            ? result[0].road_address.address_name
            : result[0].address.address_name;
          document.getElementById("mapsOrigin").value = addr;
          // 현재 위치로 지도 이동
          const center = new kakao.maps.LatLng(lat, lng);
          kakaoMap.setCenter(center);
          addMarker(center, "📍 현재 위치");
        } else {
          document.getElementById("mapsOrigin").value = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        }
        btn.textContent = "📍";
      });
    },
    () => {
      Swal.fire({ icon: "warning", title: "위치 권한을 허용해주세요.", timer: 2000, showConfirmButton: false });
      btn.textContent = "📍";
    }
  );
}

function addMarker(position, title) {
  const marker = new kakao.maps.Marker({ position, map: kakaoMap });
  const infowindow = new kakao.maps.InfoWindow({ content: `<div style="padding:5px;font-size:13px;">${title}</div>` });
  kakao.maps.event.addListener(marker, "click", () => infowindow.open(kakaoMap, marker));
  markers.push(marker);
  return marker;
}

function clearMapOverlays() {
  markers.forEach(m => m.setMap(null));
  polylines.forEach(p => p.setMap(null));
  markers = [];
  polylines = [];
}

function searchDirections() {
  const origin = document.getElementById("mapsOrigin").value.trim();
  const destination = document.getElementById("mapsDestination").value.trim();
  const infoEl = document.getElementById("mapsRouteInfo");

  if (!origin) { Swal.fire({ icon: "warning", title: "출발지를 입력하세요.", timer: 1500, showConfirmButton: false }); return; }
  if (!destination) { Swal.fire({ icon: "warning", title: "목적지를 입력하세요.", timer: 1500, showConfirmButton: false }); return; }

  clearMapOverlays();

  // 주소 또는 장소명으로 좌표 검색 (주소 실패 시 키워드 검색 폴백)
  function searchPlace(query, callback) {
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(query, (result, status) => {
      if (status === kakao.maps.services.Status.OK) {
        callback({ x: result[0].x, y: result[0].y });
      } else {
        const places = new kakao.maps.services.Places();
        places.keywordSearch(query, (result, status) => {
          if (status === kakao.maps.services.Status.OK) {
            callback({ x: result[0].x, y: result[0].y });
          } else {
            callback(null);
          }
        });
      }
    });
  }

  searchPlace(origin, (originResult) => {
    if (!originResult) {
      Swal.fire({ icon: "warning", title: "출발지를 찾을 수 없습니다.", timer: 1500, showConfirmButton: false });
      return;
    }
    const originCoord = new kakao.maps.LatLng(originResult.y, originResult.x);

    searchPlace(destination, (destResult) => {
      if (!destResult) {
        Swal.fire({ icon: "warning", title: "목적지를 찾을 수 없습니다.", timer: 1500, showConfirmButton: false });
        return;
      }
      const destCoord = new kakao.maps.LatLng(destResult.y, destResult.x);

      // 마커 추가
      addMarker(originCoord, `🚩 출발: ${origin}`);
      addMarker(destCoord, `🏁 도착: ${destination}`);

      infoEl.innerHTML = `<div class="maps-route-summary">경로 계산 중...</div>`;
      infoEl.style.display = "block";

      // 대중교통은 Google Directions API, 나머지는 OSRM
      if (currentTravelMode === "TRANSIT") {
        fetch(`${SERVER_URL}/api/maps/transit?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, { credentials: "include" })
          .then(r => r.json())
          .then(data => renderTransitRoute(data, origin, destination, originResult, destResult, infoEl))
          .catch(() => { infoEl.innerHTML = `<div class="maps-route-summary">대중교통 경로 조회 실패</div>`; });
        return;
      }

      const osrmProfile = currentTravelMode === "WALKING" ? "foot" : currentTravelMode === "BICYCLING" ? "bike" : "car";
      const routeUrl = `https://router.project-osrm.org/route/v1/${osrmProfile}/${originResult.x},${originResult.y};${destResult.x},${destResult.y}?overview=full&geometries=geojson&steps=true`;

      fetch(routeUrl)
        .then(r => r.json())
        .then(data => {
          const route = data.routes?.[0];
          const coords = route?.geometry?.coordinates || [];

          // 도로 경로 폴리라인 그리기
          const path = coords.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
          const polyline = new kakao.maps.Polyline({
            path,
            strokeWeight: 5,
            strokeColor: "#4A90E2",
            strokeOpacity: 0.9,
            strokeStyle: "solid",
          });
          polyline.setMap(kakaoMap);
          polylines.push(polyline);

          // 경로가 모두 보이도록 범위 조정
          const bounds = new kakao.maps.LatLngBounds();
          path.forEach(p => bounds.extend(p));
          kakaoMap.setBounds(bounds);

          const distM = route?.distance || 0;
          const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)}km` : `${Math.round(distM)}m`;
          const durMin = Math.round((route?.duration || 0) / 60);
          const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)}시간 ${durMin % 60}분` : `${durMin}분`;

          const modeMap = { DRIVING: "자동차", TRANSIT: "대중교통", WALKING: "도보", BICYCLING: "자전거" };
          const modeLabel = modeMap[currentTravelMode] || currentTravelMode;
          const kakaoWebUrl = `https://map.kakao.com/link/from/${encodeURIComponent(origin)},${originResult.y},${originResult.x}/to/${encodeURIComponent(destination)},${destResult.y},${destResult.x}`;

          // 단계별 경로 파싱
          const maneuverIcon = { turn: "↩", "turn left": "←", "turn right": "→", straight: "↑", "new name": "↑", roundabout: "↻", depart: "🚩", arrive: "🏁", merge: "⤵", fork: "⑂", "off ramp": "↗", "on ramp": "↗" };
          const steps = route.legs?.[0]?.steps || [];
          const stepsHtml = steps.map(step => {
            const type = step.maneuver?.type || "";
            const modifier = step.maneuver?.modifier || "";
            const key = modifier ? `${type} ${modifier}` : type;
            const icon = maneuverIcon[key] || maneuverIcon[type] || "•";
            const name = step.name || "";
            const d = step.distance >= 1000 ? `${(step.distance / 1000).toFixed(1)}km` : `${Math.round(step.distance)}m`;
            return `<div class="maps-step"><span class="maps-step-icon">${icon}</span><span class="maps-step-name">${name || "이동"}</span><span class="maps-step-dist">${d}</span></div>`;
          }).join("");

          infoEl.innerHTML = `
            <div class="maps-route-summary">
              <span class="maps-route-from">${origin}</span>
              <span class="maps-route-arrow">→</span>
              <span class="maps-route-to">${destination}</span>
              <span class="maps-route-mode">${modeLabel}</span>
              <span class="maps-route-dist">🛣 ${distStr} · ⏱ ${durStr}</span>
              <a class="maps-detail-btn" href="${kakaoWebUrl}" target="_blank" rel="noopener">🗺 카카오맵으로 보기</a>
            </div>
            <div class="maps-steps-container">${stepsHtml}</div>`;
        })
        .catch(() => {
          // OSRM 실패 시 직선으로 폴백
          const bounds = new kakao.maps.LatLngBounds();
          bounds.extend(originCoord);
          bounds.extend(destCoord);
          kakaoMap.setBounds(bounds);
          const polyline = new kakao.maps.Polyline({
            path: [originCoord, destCoord],
            strokeWeight: 4,
            strokeColor: "#4A90E2",
            strokeOpacity: 0.8,
            strokeStyle: "dashed",
          });
          polyline.setMap(kakaoMap);
          polylines.push(polyline);
          infoEl.innerHTML = `<div class="maps-route-summary"><span class="maps-route-from">${origin}</span><span class="maps-route-arrow">→</span><span class="maps-route-to">${destination}</span><span class="maps-route-dist">경로 계산 실패 (직선 표시)</span></div>`;
        });
    });
  });
}

function renderTransitRoute(data, origin, destination, originResult, destResult, infoEl) {
  if (data.status !== "OK" || !data.routes?.length) {
    infoEl.innerHTML = `<div class="maps-route-summary">대중교통 경로를 찾을 수 없습니다. (Google Directions API 활성화 확인 필요)</div>`;
    return;
  }

  const leg = data.routes[0].legs[0];
  const totalDist = leg.distance.text;
  const totalDur = leg.duration.text;

  // 출발/도착 마커
  const originCoord = new kakao.maps.LatLng(originResult.y, originResult.x);
  const destCoord   = new kakao.maps.LatLng(destResult.y, destResult.x);
  addMarker(originCoord, `🚩 출발: ${origin}`);
  addMarker(destCoord,   `🏁 도착: ${destination}`);

  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(originCoord);
  bounds.extend(destCoord);
  kakaoMap.setBounds(bounds);

  // 단계별 HTML 생성
  const vehicleIcon = { BUS: "🚌", SUBWAY: "🚇", TRAM: "🚋", RAIL: "🚆", FERRY: "⛴", CABLE_CAR: "🚡" };
  const stepsHtml = leg.steps.map(step => {
    if (step.travel_mode === "WALKING") {
      return `<div class="maps-step transit-walk">
        <span class="maps-step-icon">🚶</span>
        <span class="maps-step-name">${step.html_instructions.replace(/<[^>]+>/g, " ").trim()}</span>
        <span class="maps-step-dist">${step.distance.text} · ${step.duration.text}</span>
      </div>`;
    }
    if (step.travel_mode === "TRANSIT") {
      const t = step.transit_details;
      const vType = t.line.vehicle.type;
      const icon = vehicleIcon[vType] || "🚌";
      const lineName = t.line.short_name || t.line.name || "";
      const lineColor = t.line.color ? `background:${t.line.color};color:${t.line.text_color||"#fff"}` : "background:#4A90E2;color:#fff";
      return `<div class="maps-step transit-vehicle">
        <span class="maps-step-icon">${icon}</span>
        <div class="maps-step-transit-info">
          <span class="maps-transit-badge" style="${lineColor}">${lineName}</span>
          <span class="maps-transit-route">${t.departure_stop.name} → ${t.arrival_stop.name}</span>
          <span class="maps-transit-stops">${t.num_stops}정거장 · ${step.duration.text}</span>
        </div>
        <span class="maps-step-dist">${step.distance.text}</span>
      </div>`;
    }
    return "";
  }).join("");

  infoEl.innerHTML = `
    <div class="maps-route-summary">
      <span class="maps-route-from">${origin}</span>
      <span class="maps-route-arrow">→</span>
      <span class="maps-route-to">${destination}</span>
      <span class="maps-route-mode">대중교통</span>
      <span class="maps-route-dist">🛣 ${totalDist} · ⏱ ${totalDur}</span>
    </div>
    <div class="maps-steps-container">${stepsHtml}</div>`;
}

"use strict";


const OPENWEATHER_API_KEY = "84a30d494441f979f39183772aef7422";

// ---------- State ----------
const appState = {
  temperatureUnit: "C",
  selectedPlace: null,   // { name, lat, lon }
  forecastData: null,    // { openMeteo, metNorway, openWeather }
  forecastChart: null,
};

const getElement = (id) => document.getElementById(id);

// ---------- Helpers ----------
// All temperatures are stored in Celsius and converted only when displayed.
function convertTemperature(celsius) {
  if (celsius == null) return null;
  if (appState.temperatureUnit === "F") return celsius * 9 / 5 + 32;
  if (appState.temperatureUnit === "K") return celsius + 273.15;
  return celsius;
}

function formatTemperature(celsius) {
  if (celsius == null) return "–";
  const rounded = Math.round(convertTemperature(celsius));
  return appState.temperatureUnit === "K" ? rounded + " K" : rounded + "°" + appState.temperatureUnit;
}

// Big temperature like "+11°" (the unit letter is shown in the top bar)
function formatBigTemperature(celsius) {
  if (celsius == null) return "–";
  const rounded = Math.round(convertTemperature(celsius));
  if (appState.temperatureUnit === "K") return rounded + " K";
  return (rounded > 0 ? "+" : "") + rounded + "°";
}

const orDash = (value, suffix = "") => (value == null ? "–" : value + suffix);

function makeIcon(iconName, colorClass) {
  return '<i class="fa-solid ' + iconName + ' ' + colorClass + '" aria-hidden="true"></i>';
}

// Open-Meteo uses WMO weather codes
function getWeatherIcon(weatherCode, isDay = 1) {
  if (weatherCode === 0) return isDay ? makeIcon("fa-sun", "wi-sun") : makeIcon("fa-moon", "wi-moon");
  if (weatherCode <= 2) return isDay ? makeIcon("fa-cloud-sun", "wi-sun") : makeIcon("fa-cloud-moon", "wi-moon");
  if (weatherCode === 3) return makeIcon("fa-cloud", "wi-cloud");
  if (weatherCode <= 48) return makeIcon("fa-smog", "wi-fog");
  if (weatherCode <= 57) return makeIcon("fa-cloud-sun-rain", "wi-rain");
  if (weatherCode <= 67) return makeIcon("fa-cloud-showers-heavy", "wi-rain");
  if (weatherCode <= 77) return makeIcon("fa-snowflake", "wi-snow");
  if (weatherCode <= 82) return makeIcon("fa-cloud-showers-heavy", "wi-rain");
  if (weatherCode <= 86) return makeIcon("fa-snowflake", "wi-snow");
  return makeIcon("fa-cloud-bolt", "wi-storm");
}

// MET Norway uses text symbol codes like "partlycloudy_day" or "lightrain"
function getMetIcon(symbolCode) {
  const code = symbolCode || "";
  const isDay = !code.endsWith("_night");
  if (code.includes("thunder")) return makeIcon("fa-cloud-bolt", "wi-storm");
  if (code.includes("snow") || code.includes("sleet")) return makeIcon("fa-snowflake", "wi-snow");
  if (code.includes("rain") || code.includes("drizzle")) return makeIcon("fa-cloud-showers-heavy", "wi-rain");
  if (code.includes("fog")) return makeIcon("fa-smog", "wi-fog");
  if (code.startsWith("clearsky")) return isDay ? makeIcon("fa-sun", "wi-sun") : makeIcon("fa-moon", "wi-moon");
  if (code.startsWith("fair") || code.startsWith("partlycloudy")) {
    return isDay ? makeIcon("fa-cloud-sun", "wi-sun") : makeIcon("fa-cloud-moon", "wi-moon");
  }
  return makeIcon("fa-cloud", "wi-cloud");
}

// OpenWeatherMap uses numeric condition ids (2xx storm, 5xx rain, 6xx snow, ...)
function getOpenWeatherIcon(conditionId, iconCode) {
  const isDay = !(iconCode || "").endsWith("n");
  if (conditionId >= 200 && conditionId < 300) return makeIcon("fa-cloud-bolt", "wi-storm");
  if (conditionId >= 300 && conditionId < 600) return makeIcon("fa-cloud-showers-heavy", "wi-rain");
  if (conditionId >= 600 && conditionId < 700) return makeIcon("fa-snowflake", "wi-snow");
  if (conditionId >= 700 && conditionId < 800) return makeIcon("fa-smog", "wi-fog");
  if (conditionId === 800) return isDay ? makeIcon("fa-sun", "wi-sun") : makeIcon("fa-moon", "wi-moon");
  if (conditionId <= 802) return isDay ? makeIcon("fa-cloud-sun", "wi-sun") : makeIcon("fa-cloud-moon", "wi-moon");
  return makeIcon("fa-cloud", "wi-cloud");
}

function setStatusMessage(message) {
  getElement("status").textContent = message;
  getElement("status").hidden = !message;
}

// ---------- Search ----------
async function searchCity() {
  const cityName = getElement("q").value.trim();
  if (!cityName) return;
  setStatusMessage("Searching...");
  try {
    const response = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search?count=5&name=" + encodeURIComponent(cityName)
    );
    const searchData = await response.json();
    const resultsList = getElement("results");
    resultsList.innerHTML = "";
    if (!searchData.results) {
      setStatusMessage("No places found for \"" + cityName + "\".");
      return;
    }
    setStatusMessage("Pick a place:");
    searchData.results.forEach((place) => {
      const placeLabel = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
      addChip(resultsList, placeLabel, () => {
        resultsList.innerHTML = "";
        loadPlace({ name: placeLabel, lat: place.latitude, lon: place.longitude });
      });
    });
  } catch (error) {
    setStatusMessage("Search failed. Check your internet connection.");
  }
}

function addChip(listElement, text, onClick) {
  const listItem = document.createElement("li");
  const button = document.createElement("button");
  button.textContent = text;
  button.addEventListener("click", onClick);
  listItem.appendChild(button);
  listElement.appendChild(listItem);
}

// ---------- Geolocation ----------
function useGps() {
  if (!navigator.geolocation) {
    setStatusMessage("Geolocation is not supported in this browser.");
    return;
  }
  setStatusMessage("Getting your location...");
  navigator.geolocation.getCurrentPosition(
    (position) => loadPlace({
      name: "My location",
      lat: position.coords.latitude,
      lon: position.coords.longitude,
    }),
    () => setStatusMessage("Could not get your location. Allow location access or search a city."),
    { timeout: 10000 }
  );
}

// ---------- Fetch from three providers ----------
async function fetchOpenMeteo(latitude, longitude) {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude +
    "&current=temperature_2m,apparent_temperature,weather_code,is_day,precipitation,wind_speed_10m" +
    "&hourly=temperature_2m,weather_code,is_day,precipitation_probability,uv_index" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset" +
    "&wind_speed_unit=ms&timezone=auto&timeformat=unixtime&forecast_days=7";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Open-Meteo error");
  return response.json();
}

async function fetchMetNorway(latitude, longitude) {
  const url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=" +
    latitude.toFixed(4) + "&lon=" + longitude.toFixed(4);
  const response = await fetch(url);
  if (!response.ok) throw new Error("MET Norway error");
  return response.json();
}

async function fetchOpenWeather(latitude, longitude) {
  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === "PASTE_YOUR_KEY_HERE") {
    throw new Error("OpenWeatherMap API key missing");
  }
  const baseUrl = "https://api.openweathermap.org/data/2.5/";
  const query = "?lat=" + latitude + "&lon=" + longitude + "&units=metric&appid=" + OPENWEATHER_API_KEY;
  const [currentResponse, forecastResponse] = await Promise.all([
    fetch(baseUrl + "weather" + query),
    fetch(baseUrl + "forecast" + query),
  ]);
  if (!currentResponse.ok || !forecastResponse.ok) throw new Error("OpenWeatherMap error");
  return { current: await currentResponse.json(), forecast: await forecastResponse.json() };
}

async function loadPlace(place) {
  appState.selectedPlace = place;
  setStatusMessage("Loading weather...");
  // allSettled: if one provider fails, the app still works with the others
  const [openMeteoResult, metNorwayResult, openWeatherResult] = await Promise.allSettled([
    fetchOpenMeteo(place.lat, place.lon),
    fetchMetNorway(place.lat, place.lon),
    fetchOpenWeather(place.lat, place.lon),
  ]);
  if (openMeteoResult.status !== "fulfilled") {
    setStatusMessage("Could not load weather. Try again later.");
    return;
  }
  const valueOrNull = (result) => (result.status === "fulfilled" ? result.value : null);
  appState.forecastData = {
    openMeteo: openMeteoResult.value,
    metNorway: valueOrNull(metNorwayResult),
    openWeather: valueOrNull(openWeatherResult),
  };
  const unavailable = [];
  if (!appState.forecastData.metNorway) unavailable.push("MET Norway");
  if (!appState.forecastData.openWeather) unavailable.push("OpenWeatherMap");
  setStatusMessage(unavailable.length ? unavailable.join(" and ") + " unavailable right now." : "");
  renderWeather();
}

// ---------- Rendering ----------
function buildProviderCard(providerName, iconHtml, temperatureCelsius, rows) {
  const rowsHtml = rows.map(([label, value]) =>
    '<div class="row"><dt>' + label + '</dt><dd>' + value + '</dd></div>'
  ).join("");
  return '<div class="prov-main"><span class="prov-icon">' + iconHtml + '</span>' +
    '<span class="prov-temp">' + formatBigTemperature(temperatureCelsius) + '</span></div>' +
    '<h3 class="prov-name">' + providerName + '</h3><dl>' + rowsHtml + '</dl>';
}

function renderWeather() {
  if (!appState.forecastData) return;
  const { openMeteo, metNorway, openWeather } = appState.forecastData;
  const timeZone = openMeteo.timezone;
  const currentWeather = openMeteo.current;
  const hourFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const dayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone });
  const weekdayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone });

  // Page title and "Today ..." heading
  const placeName = appState.selectedPlace.name;
  getElement("pageTitle").textContent =
    placeName === "My location" ? "Weather at your location" : "Weather in " + placeName.split(",")[0];
  getElement("todayTitle").textContent = "Today " + weekdayFormatter.format(currentWeather.time * 1000) +
    " at " + hourFormatter.format(currentWeather.time * 1000);

  const sunrise = openMeteo.daily.sunrise[0];
  const sunset = openMeteo.daily.sunset[0];
  getElement("sunTimes").innerHTML = sunrise && sunset
    ? '<i class="fa-solid fa-sun"></i>' + hourFormatter.format(sunrise * 1000) +
      '<i class="fa-solid fa-moon"></i>' + hourFormatter.format(sunset * 1000)
    : "";

  // Which hourly entries are the next 24 hours (en-GB gives the 24-hour clock)
  const oneHourAgoInSeconds = Date.now() / 1000 - 3600;
  const firstHourIndex = openMeteo.hourly.time.findIndex((time) => time > oneHourAgoInSeconds);
  const hourIndexes = [...Array(24).keys()]
    .map((offset) => firstHourIndex + offset)
    .filter((index) => index < openMeteo.hourly.time.length);

  // Provider 1: Open-Meteo
  const uvIndex = openMeteo.hourly.uv_index[firstHourIndex];
  getElement("openMeteoCard").innerHTML = buildProviderCard(
    "Open-Meteo",
    getWeatherIcon(currentWeather.weather_code, currentWeather.is_day),
    currentWeather.temperature_2m,
    [
      ["Feels like", formatTemperature(currentWeather.apparent_temperature)],
      ["Risk of rain", '<i class="fa-solid fa-droplet"></i>' + orDash(openMeteo.hourly.precipitation_probability[firstHourIndex], "%")],
      ["Rainfall", orDash(currentWeather.precipitation, " mm")],
      ["Wind", orDash(currentWeather.wind_speed_10m, " m/s")],
      ["UV index", uvIndex == null ? "–" : Math.round(uvIndex * 10) / 10],
    ]
  );

  // Provider 2: MET Norway
  if (metNorway) {
    const firstEntry = metNorway.properties.timeseries[0];
    const details = firstEntry.data.instant.details;
    const nextHour = firstEntry.data.next_1_hours;
    getElement("metNorwayCard").innerHTML = buildProviderCard(
      "Norwegian Meteorological Institute",
      getMetIcon(nextHour?.summary?.symbol_code),
      details.air_temperature,
      [
        ["Humidity", orDash(details.relative_humidity, "%")],
        ["Rainfall", orDash(nextHour?.details?.precipitation_amount, " mm")],
        ["Wind", orDash(details.wind_speed, " m/s")],
        ["Cloud cover", orDash(details.cloud_area_fraction, "%")],
        ["UV index", orDash(details.ultraviolet_index_clear_sky)],
      ]
    );
  } else {
    getElement("metNorwayCard").innerHTML =
      '<h3 class="prov-name">Norwegian Meteorological Institute</h3><p>Not available right now.</p>';
  }

  // Provider 3: OpenWeatherMap
  if (openWeather) {
    const owCurrent = openWeather.current;
    const condition = owCurrent.weather[0];
    const rainLastHour = owCurrent.rain ? owCurrent.rain["1h"] : 0;
    const chanceOfRain = openWeather.forecast.list[0].pop;
    getElement("openWeatherCard").innerHTML = buildProviderCard(
      "OpenWeatherMap",
      getOpenWeatherIcon(condition.id, condition.icon),
      owCurrent.main.temp,
      [
        ["Feels like", formatTemperature(owCurrent.main.feels_like)],
        ["Risk of rain", '<i class="fa-solid fa-droplet"></i>' + Math.round(chanceOfRain * 100) + "%"],
        ["Rainfall", orDash(rainLastHour, " mm")],
        ["Wind", orDash(owCurrent.wind.speed, " m/s")],
        ["Humidity", orDash(owCurrent.main.humidity, "%")],
      ]
    );
  } else {
    getElement("openWeatherCard").innerHTML =
      '<h3 class="prov-name">OpenWeatherMap</h3><p>Not available (check the API key in script.js).</p>';
  }

  getElement("current").hidden = false;
  getElement("favBtn").hidden = false;
  updateFavoriteButton();
  applyTheme(currentWeather.temperature_2m, currentWeather.is_day);

  // Next 24 hours
  getElement("hourly").innerHTML = hourIndexes.map((index) =>
    '<div class="hour"><div>' + hourFormatter.format(openMeteo.hourly.time[index] * 1000) + '</div>' +
    '<div class="ic">' + getWeatherIcon(openMeteo.hourly.weather_code[index], openMeteo.hourly.is_day[index]) + '</div>' +
    '<div>' + formatTemperature(openMeteo.hourly.temperature_2m[index]) + '</div></div>'
  ).join("");
  getElement("hourlySec").hidden = false;

  // 7-day forecast
  getElement("daily").innerHTML = openMeteo.daily.time.map((time, index) =>
    '<div class="day"><span>' + dayFormatter.format(time * 1000) + '</span>' +
    '<span class="ic">' + getWeatherIcon(openMeteo.daily.weather_code[index]) + '</span>' +
    '<span class="range">' + formatTemperature(openMeteo.daily.temperature_2m_min[index]) + ' / ' +
    formatTemperature(openMeteo.daily.temperature_2m_max[index]) + '</span></div>'
  ).join("");
  getElement("dailySec").hidden = false;

  drawComparisonChart(hourIndexes, hourFormatter);
}

function drawComparisonChart(hourIndexes, hourFormatter) {
  const { openMeteo, metNorway, openWeather } = appState.forecastData;
  if (!metNorway && !openWeather) {
    getElement("chartSec").hidden = true;
    return;
  }

  const hourLabels = hourIndexes.map((index) => hourFormatter.format(openMeteo.hourly.time[index] * 1000));
  const datasets = [{
    label: "Open-Meteo",
    data: hourIndexes.map((index) => convertTemperature(openMeteo.hourly.temperature_2m[index])),
    borderColor: "#ffd166", backgroundColor: "#ffd166", tension: 0.3,
  }];

  if (metNorway) {
    // MET Norway timestamps are UTC ISO strings; convert them to unix seconds to match Open-Meteo
    const metTemperatureByTime = {};
    metNorway.properties.timeseries.forEach((entry) => {
      metTemperatureByTime[Date.parse(entry.time) / 1000] = entry.data.instant.details.air_temperature;
    });
    datasets.push({
      label: "MET Norway",
      data: hourIndexes.map((index) =>
        convertTemperature(metTemperatureByTime[openMeteo.hourly.time[index]] ?? null)),
      borderColor: "#7bdff2", backgroundColor: "#7bdff2", tension: 0.3,
    });
  }

  if (openWeather) {
    // OpenWeatherMap gives one value every 3 hours (unix seconds), so some hours are empty
    const owTemperatureByTime = {};
    openWeather.forecast.list.forEach((entry) => { owTemperatureByTime[entry.dt] = entry.main.temp; });
    datasets.push({
      label: "OpenWeatherMap",
      data: hourIndexes.map((index) =>
        convertTemperature(owTemperatureByTime[openMeteo.hourly.time[index]] ?? null)),
      borderColor: "#ff8fab", backgroundColor: "#ff8fab", tension: 0.3,
      spanGaps: true, // connect the 3-hourly points with a line
    });
  }

  if (appState.forecastChart) appState.forecastChart.destroy();
  appState.forecastChart = new Chart(getElement("chart"), {
    type: "line",
    data: { labels: hourLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#fff" } } },
      scales: {
        x: { ticks: { color: "#fff", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.15)" } },
        y: {
          ticks: { color: "#fff" },
          grid: { color: "rgba(255,255,255,0.15)" },
          title: {
            display: true,
            text: appState.temperatureUnit === "K" ? "K" : "°" + appState.temperatureUnit,
            color: "#fff",
          },
        },
      },
    },
  });
  getElement("chartSec").hidden = false;
}

// The whole page changes color with temperature and day/night
function applyTheme(temperatureCelsius, isDay) {
  let colorA, colorB;
  if (!isDay) [colorA, colorB] = ["#070b1f", "#1c2150"];                        // night: dark
  else if (temperatureCelsius <= 0) [colorA, colorB] = ["#1e6fd9", "#8fd3ff"];  // freezing: icy blue
  else if (temperatureCelsius <= 10) [colorA, colorB] = ["#1b5fa8", "#2a8fc4"]; // cold: blue
  else if (temperatureCelsius <= 20) [colorA, colorB] = ["#1f9d7a", "#8bc34a"]; // mild: green
  else if (temperatureCelsius <= 27) [colorA, colorB] = ["#f08a24", "#e85d2a"]; // warm: orange
  else [colorA, colorB] = ["#d62828", "#f77f00"];                               // hot: red
  document.documentElement.style.setProperty("--theme-a", colorA);
  document.documentElement.style.setProperty("--theme-b", colorB);
}

// ---------- Favorites ----------
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem("favs")) || []; } catch (error) { return []; }
}

function saveFavorites(favorites) {
  try { localStorage.setItem("favs", JSON.stringify(favorites)); } catch (error) { /* storage blocked */ }
}

function isFavorite(place) {
  return loadFavorites().some((favorite) => favorite.name === place.name);
}

function toggleFavorite() {
  if (!appState.selectedPlace) return;
  let favorites = loadFavorites();
  if (isFavorite(appState.selectedPlace)) {
    favorites = favorites.filter((favorite) => favorite.name !== appState.selectedPlace.name);
  } else {
    favorites.push(appState.selectedPlace);
  }
  saveFavorites(favorites);
  updateFavoriteButton();
  renderFavorites();
}

function updateFavoriteButton() {
  const isCurrentFavorite = appState.selectedPlace && isFavorite(appState.selectedPlace);
  const starStyle = isCurrentFavorite ? "fa-solid" : "fa-regular";
  getElement("favBtn").innerHTML =
    '<i class="' + starStyle + ' fa-star"></i> ' + (isCurrentFavorite ? "Saved" : "Save");
}

function renderFavorites() {
  const favoritesList = getElement("favs");
  favoritesList.innerHTML = "";
  loadFavorites().forEach((favorite) => addChip(favoritesList, favorite.name, () => loadPlace(favorite)));
}

// ---------- Events ----------
getElement("searchBtn").addEventListener("click", searchCity);
getElement("q").addEventListener("keydown", (event) => { if (event.key === "Enter") searchCity(); });
getElement("gpsBtn").addEventListener("click", useGps);
getElement("favBtn").addEventListener("click", toggleFavorite);

document.querySelectorAll(".units button").forEach((unitButton) => {
  unitButton.addEventListener("click", () => {
    appState.temperatureUnit = unitButton.dataset.unit;
    document.querySelectorAll(".units button").forEach((button) => {
      button.classList.toggle("active", button === unitButton);
    });
    renderWeather(); // re-render with the stored data, no new API call
  });
});

renderFavorites();
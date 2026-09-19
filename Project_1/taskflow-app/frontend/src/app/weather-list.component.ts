import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, Inject, OnInit, PLATFORM_ID } from '@angular/core';

interface Weather {
  city: string;
  temperature: number;
  condition: string;
  humidity: number;
  version: string;
}

@Component({
  selector: 'app-weather-list',
  standalone: true,
  template: `
    <section class="weather-list" aria-labelledby="weather-title">
      <div class="heading">
        <div>
          <p class="eyebrow">Live conditions</p>
          <h1 id="weather-title">Weather list</h1>
        </div>
        @if (weather.length) {
          <span class="version">API v{{ weather[0].version }}</span>
        }
      </div>

      @if (loading) {
        <p class="status" role="status">Loading weather...</p>
      } @else if (error) {
        <p class="status error" role="alert">{{ error }}</p>
      } @else {
        <ul>
          @for (item of weather; track item.city) {
            <li>
              <div>
                <h2>{{ item.city }}</h2>
                <p>{{ item.condition }}</p>
              </div>
              <div class="reading">
                <strong>{{ item.temperature }}&deg;</strong>
                <span>Humidity {{ item.humidity }}%</span>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      width: min(100%, 42rem);
    }

    .weather-list {
      background: #f8f4ec;
      border: 1px solid #d8d0c3;
      border-radius: 8px;
      padding: clamp(1.25rem, 4vw, 2rem);
      color: #173b3f;
    }

    .heading {
      align-items: start;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .eyebrow {
      color: #b45f3c;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin: 0 0 0.4rem;
      text-transform: uppercase;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      font-size: clamp(1.6rem, 5vw, 2.4rem);
      line-height: 1.1;
    }

    h2 {
      font-size: 1.25rem;
      margin-bottom: 0.35rem;
    }

    li {
      align-items: center;
      background: #fffdf8;
      border-left: 4px solid #e38b56;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.1rem 1.25rem;
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .reading {
      align-items: end;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    strong {
      color: #b45f3c;
      font-size: 2rem;
      line-height: 1;
    }

    .version,
    .reading span {
      color: #617174;
      font-size: 0.8rem;
    }

    .status {
      color: #617174;
    }

    .error {
      color: #a43d35;
    }

    @media (max-width: 34rem) {
      li {
        align-items: start;
        flex-direction: column;
      }

      .reading {
        align-items: start;
      }
    }
  `
})
export class WeatherListComponent implements OnInit {
  weather: Weather[] = [];
  loading = true;
  error = '';

  constructor(
    private readonly http: HttpClient,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.loading = false;
      return;
    }

    this.http.get<Weather>('/api/weather').subscribe({
      next: (response) => {
        this.weather = [response];
        this.loading = false;
      },
      error: () => {
        this.error = 'Weather data is unavailable right now.';
        this.loading = false;
      }
    });
  }
}
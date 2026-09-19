import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, signal } from '@angular/core';

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
  templateUrl: './weather-list.component.html',
  styleUrl: './weather-list.component.css'
})
export class WeatherListComponent {
  readonly weather = signal<Weather[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly http: HttpClient) {
    afterNextRender(() => this.loadWeather());
  }

  private loadWeather(): void {
    this.http.get<Weather>('/api/weather').subscribe({
      next: (response) => {
        this.weather.set([response]);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Weather data is unavailable right now.');
        this.loading.set(false);
      }
    });
  }
}
import { Component } from '@angular/core';
import { WeatherListComponent } from './weather-list/weather-list.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [WeatherListComponent],
  template: '<main><app-weather-list /></main>',
  styles: `
    :host {
      background: #173b3f;
      display: block;
      min-height: 100dvh;
    }

    main {
      align-items: center;
      display: flex;
      justify-content: center;
      min-height: 100dvh;
      padding: 1rem;
    }
  `
})
export class AppComponent {}
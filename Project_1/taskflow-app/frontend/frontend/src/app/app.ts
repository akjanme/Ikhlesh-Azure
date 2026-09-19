import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HttpClientModule],
  template: `
    <h1>{{ message }}</h1>
    <p>version: {{ version }}</p>
  `
})
export class AppComponent implements OnInit {
  message = 'Loading...';
  version = '';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http.get<any>('/api/weather').subscribe(response => {
      this.message = response.message;
      this.version = response.version;
    });
  }
}
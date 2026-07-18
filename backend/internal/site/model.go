package site

type Model struct {
	ID        string    `json:"id"`
	Topic     string    `json:"topic"`
	SiteTitle string    `json:"siteTitle"`
	Tagline   string    `json:"tagline"`
	Theme     Theme     `json:"theme"`
	Sections  []Section `json:"sections"`
}

type Theme struct {
	Primary    string `json:"primary"`
	Background string `json:"background"`
	Text       string `json:"text"`
	FontFamily string `json:"fontFamily"`
	Spacing    int    `json:"spacing"`
}

type Section struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	ImageAlt string `json:"imageAlt"`
	Visible  bool   `json:"visible"`
}

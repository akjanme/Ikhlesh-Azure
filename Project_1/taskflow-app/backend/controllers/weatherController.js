const APP_VERSION = process.env.APP_VERSION || '1.0.0';
exports.getWeather = (req, res) => {
    res.json({
        version: APP_VERSION,
        city: "Dubai",
        temperature: 35,
        condition: "Sunny",
        humidity: 55
    });
};
const express = require("express");
const cors = require('cors');

const weatherRoutes = require("./routes/weatherRoutes");
const userRoutes = require("./routes/userRoutes");

 
const app = express();
app.use(cors());


const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use("/api/weather", weatherRoutes);
app.use("/api/users", userRoutes);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
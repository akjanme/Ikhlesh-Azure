const APP_VERSION = process.env.APP_VERSION || '1.0.0';
exports.getUsers = (req, res) => {
    res.json({
        version: APP_VERSION,
        users: [
            {
                id: 1,
                name: "Anil",
                role: "Developer"
            },
            {
                id: 2,
                name: "Rahul",
                role: "Tester"
            }
        ]
    });
};
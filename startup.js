

// Import required modules
const express = require("express");
const mysql = require("mysql2/promise");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");
const ejs = require("ejs");
const path = require("path");
const flash = require("connect-flash");
require("dotenv").config();

const app = express();

// Database connection
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: true
  }
});

// Middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

// Session configuration
app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: false,
  })
);

// Flash messages middleware
app.use(flash());

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const [rows] = await db.query("SELECT * FROM users WHERE username = ?", [
        username,
      ]);
      if (rows.length === 0) {
        return done(null, false, { message: "Invalid username or password" });
      }
      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: "Invalid username or password" });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// Passport serialization and deserialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
    done(null, rows[0]);
  } catch (err) {
    done(err);
  }
});

// Middleware to ensure the user is an admin
function isAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.redirect("/"); // Redirect to home if not an admin
  }
  next(); // Proceed if user is admin
}

// Routes
app.get("/", async (req, res) => {
  const userId = req.user?.id || null;;
  let basketedItems = new Set();
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  const requestUrl = '/';

  try {
    if(userId) {
      // Fetch the user's basket
      const [basket] = await db.query(
          "SELECT items.id FROM basket INNER JOIN items ON basket.item_id = items.id WHERE basket.user_id = ?",
          [userId]
      );

      // Create a set of sports item IDs that are in the user's basket
       basketedItems = new Set(basket.map(basket => basket.id));
    }

      // Fetch the available sports items (menu)
      const [items] = await db.query("SELECT * FROM items");

      res.render("home", { user: req.user, items, basketedItems, errorMessage, successMessage, requestUrl });
  } catch (err) {
      console.error("Error fetching baskets:", err);
      res.status(500).send("Internal Server Error.");
  }
});


app.get("/menu", async (req, res) => {
  const [items] = await db.query("SELECT * FROM items");
  res.render("menu", { user: req.user, items });
});

app.get("/login", (req, res) => {
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  res.render("login", { errorMessage, successMessage });
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      return next(err); // Handle errors
    }
    if (!user) {
      // Authentication failed
      req.flash("error", info.message); // Set flash message
      return res.redirect("/login");
    }
    // Authentication succeeded
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      // Redirect based on user role
      if (user.role === "admin") {
        return res.redirect("/admin");
      } else {
        return res.redirect("/");
      }
    });
  })(req, res, next);
});

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

app.get("/register", (req, res) => {
  const errorMessage = req.flash("error");
  res.render("register", { errorMessage });
});

app.post("/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    await db.query(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
      [req.body.username, hashedPassword, "user"]
    );

    req.flash("success", "Registration successful! You can now log in.");
    res.redirect("/login"); // Redirect to login with success message
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      req.flash("error", "Username already exists");
    } else {
      req.flash("error", "An error occurred during registration");
    }
    res.redirect("/register");
  }
});

// Admin page
app.get("/admin", isAdmin, async (req, res) => {
  const [items] = await db.query("SELECT * FROM items");
  res.render("admin", { items, user: req.user });
});

// Admin sports item page
app.get("/admin/item", isAdmin, (req, res) => {
  res.render("admin-item", {
    errorMessage: req.flash("error"),
    successMessage: req.flash("success"),
    user: req.user,
  });
});

app.post("/admin/item", async (req, res) => {
  try {
    const { itemName, itemPrice, imageUrl, itemDescription } = req.body;

    if (!itemName || !itemPrice || !imageUrl || !itemDescription) {
      req.flash("error", "All fields are required.");
      return res.redirect("/admin/item");
    }
    await db.query(
      "INSERT INTO items (name, price, image_url, description) VALUES (?, ?, ?, ?)",
      [itemName, itemPrice, imageUrl, itemDescription]
    );


    req.flash("success", "sports item added successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("ERRROR", err);
    req.flash("error", "An error occurred while adding sports item.");
    res.redirect("/admin/item");
  }
});

// Admin update sports item page
app.get("/admin/update/:id", isAdmin, async (req, res) => {
  const itemId = req.params.id;
  try {
    const [rows] = await db.query("SELECT * FROM items WHERE id = ?", [itemId]);

    if (rows.length === 0) {
      req.flash("error", "Item not found.");
      return res.redirect("/admin");
    }

    const item = rows[0];
    res.render("admin-update", {
      item,
      errorMessage: req.flash("error"),
      successMessage: req.flash("success"),
      user: req.user,
    });
  } catch (err) {
    console.log("Error fetching sports item details:", err);
    req.flash("error", "An error occurred while fetching sports item details.");
    res.redirect("/admin");
  }
});

// Post route to update sports item details
app.post("/admin/update/:id", isAdmin, async (req, res) => {
  const itemId = req.params.id;
  const { itemName, itemPrice, imageUrl, itemDescription } = req.body;

  if (!itemName || !itemPrice || !imageUrl || !itemDescription) {
    req.flash("error", "All fields are required.");
    return res.redirect(`/admin/update/${itemId}`);
  }

  try {
    await db.query(
      "UPDATE items SET name = ?, price = ?, image_url = ?, description = ? WHERE id = ?",
      [itemName, itemPrice, imageUrl, itemDescription, itemId]
    );

    req.flash("success", "sports item updated successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("Error updating sports item:", err);
    req.flash("error", "An error occurred while updating sports item.");
    res.redirect(`/admin/update/${itemId}`);
  }
});

// Route to handle delete sports item request
app.post("/admin/delete/:id", isAdmin, async (req, res) => {
  const itemId = req.params.id;

  try {
    await db.query("DELETE FROM items WHERE id = ?", [itemId]);

    req.flash("success", "sports item deleted successfully!");
    res.redirect("/admin");
  } catch (err) {
    console.log("Error deleting sports item:", err);
    req.flash("error", "An error occurred while deleting sports item.");
    res.redirect("/admin");
  }
});


app.post("/add-to-basket", async (req, res) => {
  const { itemId } = req.body;

  if(!req.user) {
    req.flash("error", "You must be logged in to add to basket.");
    return res.redirect("/login");
  }
  
  const userId = req.user.id;  // Assuming the user is logged in

  if (!userId || !itemId) {
      return res.status(400).send("Invalid request.");
  }

  try {
      // Check if the user already has this sports item in their basket
      const [existingbasket] = await db.query(
          "SELECT * FROM basket WHERE user_id = ? AND item_id = ?",
          [userId, itemId]
      );

      if (existingbasket.length === 0) {
          // If the user doesn't have this sports item in their basket, insert a new record
          await db.query(
              "INSERT INTO basket (user_id, item_id) VALUES (?, ?)",
              [userId, itemId]
          );
      }
      req.flash("success", "Added to Basket successfully!");
      res.redirect("/");  // Redirect back to the home page
  } catch (err) {
      console.error("Error adding to basket:", err);
      req.flash("error", "Error adding to basket!");
      res.status(500).send("Internal Server Error.");
  }

});

// Route to handle removing a sports item from the user's basket
app.post("/remove-from-basket", async (req, res) => {
  // Check if the user is logged in
  if (!req.user) {
      // If not logged in, redirect to login page
      return res.redirect("/login");
  }

  const userId = req.user.id;  // Get the user's ID from the session or authentication system
  const itemId = req.body.itemId;  // Get the sports item ID from the form submission
  const redirectUrl = req.body.redirectUrl || '/';  // Get the redirect URL from the form, default to homepage

  try {
      // Delete the basket entry for the user and sports item
      await db.query(
          "DELETE FROM basket WHERE user_id = ? AND item_id = ?",
          [userId, itemId]
      );

      // Redirect the user back to the page they were on
      req.flash("success", "Removed from Basket successfully!");
      res.redirect(redirectUrl);
  } catch (err) {
      console.error("Error removing from basket:", err);
      req.flash("error", "Error removing from basket!");
      res.status(500).send("Internal Server Error.");
  }
});


// Route to display the user's baskets
app.get("/my-basket", async (req, res) => {
  // Check if the user is logged in
  if (!req.user) {
      return res.redirect("/login");  // Redirect to login if not logged in
  }
  const errorMessage = req.flash("error");
  const successMessage = req.flash("success");
  const requestUrl = '/my-basket';

  const userId = req.user.id; // Get the user's ID from the session or authentication system

  try {
      // Fetch the baskets for the logged-in user
      const [baskets] = await db.query(
          "SELECT basket.id, items.id as item_id, items.name, items.description, items.price, items.image_url FROM basket JOIN items ON basket.item_id = items.id WHERE basket.user_id = ?",
          [userId]
      );

      // Render the "My basket" page with the user's baskets
      res.render("my-basket", { user: req.user, baskets, errorMessage, successMessage, requestUrl });
  } catch (err) {
      console.error("Error fetching baskets:", err);
      res.status(500).send("Internal Server Error.");
  }
});



// Start the server
app.listen(8080, () => console.log("Server running on port 8080"));
